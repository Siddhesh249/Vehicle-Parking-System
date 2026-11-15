#!/usr/bin/env node
/**
 * Run every project check in one pass, on any OS:
 * formatting, server Jest, client Jest, lint, production build, and the
 * optional k6 concurrency test (skipped automatically when k6 is missing).
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import { checkRuntime, ensureDependencies, npmInvocation } from "./lib/deps.mjs";
import { dropDatabase, loadServerEnv, mongoHints, resolveMongo } from "./lib/mongo.mjs";
import { findFreePort, isPortFree } from "./lib/ports.mjs";
import {
  flushOutput,
  banner,
  fail,
  info,
  ok,
  reportError,
  skip,
  step,
} from "./lib/ui.mjs";
import {
  installSignalHandlers,
  isShuttingDown,
  runInherit,
  shutdownAll,
  which,
} from "./lib/proc.mjs";
import { logFile, seedDatabase, startApi, stopChild, waitForApi } from "./lib/stack.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const HELP = `Usage: npm run check -- [options]

Runs formatting, server tests, client tests, lint, the production build, and
the optional k6 concurrency test.

Options:
  --only <ids>          Comma-separated steps to run:
                        format, server, client, lint, build, loadtest
  --skip <ids>          Comma-separated steps to skip
  --skip-loadtest       Skip the k6 concurrency test
  --require-loadtest    Fail when k6 is not installed
  --memory-db           Use a temporary MongoDB for the load test
  --mongo=<mode>        auto (default) | local | memory
  --no-install          Fail instead of installing missing dependencies
  --verbose, -v         Accepted for symmetry with npm start
  --help, -h            Show this help

Environment: SKIP_LOADTEST=1 and REQUIRE_LOADTEST=1 still work.`;

function formatDuration(milliseconds) {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

async function requireSuccess(
  args,
  { env = {}, hint, command = `npm ${args.join(" ")}` } = {},
) {
  const npm = npmInvocation();
  const result = await runInherit(npm.command, [...npm.args, ...args], {
    cwd: ROOT,
    env,
    shell: npm.shell,
  });
  if (result.code !== 0) {
    fail(
      `${command} failed.`,
      [hint, "Scroll up to the first error in the output above."].filter(Boolean),
    );
  }
}

async function runLoadTest(options) {
  if (options.skipLoadTest) {
    skip("k6 load test skipped (--skip-loadtest).");
    return { skipped: true };
  }

  const k6 = which("k6");
  if (!k6) {
    if (options.requireLoadTest) {
      fail("k6 is required by --require-loadtest but was not found.", [
        "Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/",
      ]);
    }
    skip("k6 is not installed, so the optional concurrency test was skipped.");
    return { skipped: true };
  }

  const database = process.env.LOADTEST_DB || "vehicle_parking_loadtest";
  const preferredPort = Number(process.env.LOADTEST_PORT) || 5100;
  const port = (await isPortFree(preferredPort))
    ? preferredPort
    : await findFreePort(preferredPort + 1);
  const apiUrl = `http://127.0.0.1:${port}`;
  const apiLog = logFile("loadtest-api");

  const mongo = await resolveMongo(ROOT, { mode: options.mongoMode, database });
  let api = null;
  try {
    info(`  Using an isolated database: ${database}`);
    try {
      await dropDatabase(ROOT, mongo.uri);
    } catch (error) {
      fail(`Could not reset the load-test database: ${error.message}`, mongoHints());
    }
    await seedDatabase(ROOT, {
      mongoUri: mongo.uri,
      resetDemo: true,
      demoData: false,
      password: "password123",
    });

    info(`  Starting a temporary API on ${apiUrl}`);
    api = startApi(ROOT, {
      port,
      mongoUri: mongo.uri,
      clientUrl: "http://127.0.0.1:5173",
      logFile: apiLog,
      extraEnv: { JWT_SECRET: process.env.JWT_SECRET || "vps-local-loadtest-secret" },
    });
    await waitForApi(apiUrl, api, apiLog, { timeoutMs: 60000 });

    const result = await runInherit(
      k6,
      ["run", path.join(ROOT, "loadtest", "entry-concurrency.js")],
      {
        cwd: ROOT,
        env: {
          BASE_URL: apiUrl,
          VUS: process.env.VUS || "50",
          SEED_PASSWORD: "password123",
        },
      },
    );
    if (result.code !== 0) {
      fail("The k6 concurrency test failed.", [
        "The test fails when two vehicles are allocated the same spot.",
        "Review the k6 summary above, then rerun with: npm run check -- --only=loadtest",
      ]);
    }
    return { skipped: false };
  } finally {
    if (api) await stopChild(api);
    await mongo.stop();
  }
}

function buildSteps(options) {
  return [
    {
      id: "format",
      label: "Formatting check",
      run: () =>
        requireSuccess(["run", "format:check"], {
          hint: "Run `npm run format` to rewrite the files, then review the diff.",
        }),
    },
    {
      id: "server",
      label: "Server tests (Jest + Supertest)",
      run: () =>
        requireSuccess(["test", "--prefix", "server"], {
          hint: "Run `npm test --prefix server` on its own to see the full Jest output.",
        }),
    },
    {
      id: "client",
      label: "Client tests (Jest + React Testing Library)",
      run: () =>
        requireSuccess(["test", "--prefix", "client"], {
          hint: "Run `npm test --prefix client` on its own to see the full Jest output.",
        }),
    },
    {
      id: "lint",
      label: "Client lint",
      run: () =>
        requireSuccess(["run", "lint"], {
          hint: "Run `npm run lint` and fix the reported issues.",
        }),
    },
    {
      id: "build",
      label: "Client production build (real API mode)",
      run: () =>
        requireSuccess(["run", "build", "--prefix", "client"], {
          env: { VITE_API_MODE: "real" },
          hint: "Run `npm run build --prefix client` to see the full Vite error.",
        }),
    },
    {
      id: "loadtest",
      label: "k6 concurrent allocation test",
      run: () => runLoadTest(options),
    },
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2), {
    command: "npm run check",
    booleans: {
      "--skip-loadtest": ["skipLoadTest", true],
      "--require-loadtest": ["requireLoadTest", true],
      "--memory-db": ["mongoMode", "memory"],
      "--no-install": ["install", false],
      "--verbose": ["verbose", true],
      "-v": ["verbose", true],
      "--help": ["help", true],
      "-h": ["help", true],
    },
    values: {
      "--only": "only",
      "--skip": "skip",
      "--mongo": "mongoMode",
    },
  });

  if (options.help) {
    info(HELP);
    return 0;
  }

  if (process.env.SKIP_LOADTEST === "1") options.skipLoadTest = true;
  if (process.env.REQUIRE_LOADTEST === "1") options.requireLoadTest = true;

  banner("Vehicle Parking System", "full check suite");

  step("Checking the runtime");
  const runtime = checkRuntime();
  ok(`Node.js ${runtime.node} with npm ${runtime.npm}`);

  await ensureDependencies(ROOT, { install: options.install !== false });
  loadServerEnv(ROOT);

  const allSteps = buildSteps(options);
  const validIds = allSteps.map((entry) => entry.id);
  const parseIds = (value, flag) => {
    if (value === undefined) return null;
    const ids = String(value)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const unknown = ids.filter((id) => !validIds.includes(id));
    if (unknown.length > 0) {
      fail(
        `Unknown step${unknown.length > 1 ? "s" : ""} for ${flag}: ${unknown.join(", ")}`,
        [`Valid steps: ${validIds.join(", ")}`],
      );
    }
    return ids;
  };

  const only = parseIds(options.only, "--only");
  const skipped = parseIds(options.skip, "--skip");

  const selected = allSteps.filter(
    (entry) =>
      (!only || only.includes(entry.id)) && (!skipped || !skipped.includes(entry.id)),
  );
  if (selected.length === 0) {
    fail("No checks selected.", [`Valid steps: ${validIds.join(", ")}`]);
  }

  const startedAt = Date.now();
  let ran = 0;
  let skippedCount = 0;

  for (const entry of selected) {
    step(entry.label);
    const began = Date.now();
    const result = await entry.run();
    if (result?.skipped) {
      skippedCount += 1;
    } else {
      ran += 1;
      ok(`completed in ${formatDuration(Date.now() - began)}`);
    }
    if (isShuttingDown()) return 130;
  }

  step("Summary");
  const elapsed = formatDuration(Date.now() - startedAt);
  const summary = [`${ran} check${ran === 1 ? "" : "s"} passed`];
  if (skippedCount > 0) summary.push(`${skippedCount} skipped`);
  info(`  ${summary.join(", ")} in ${elapsed}.`);
  info("  All checks completed successfully.");
  return 0;
}

installSignalHandlers();
let exitCode = 0;
try {
  exitCode = (await main()) ?? 0;
} catch (error) {
  exitCode = reportError(error);
} finally {
  await shutdownAll();
  await flushOutput();
}
process.exit(exitCode);
