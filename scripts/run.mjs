#!/usr/bin/env node
/**
 * One-command launcher for the Vehicle Parking System.
 *
 * Works the same on Windows, macOS and Linux:
 *   - verifies Node.js and npm
 *   - installs the three package trees when their lockfile changed
 *   - connects to a local MongoDB, or starts a temporary one (auto mode)
 *   - seeds demo data, starts the API and the Vite dev server, health-checks
 *     both, then opens the app and the simulation console
 *   - stops the whole process tree on Ctrl+C
 */
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import { openUrl } from "./lib/browser.mjs";
import { checkRuntime, ensureDependencies } from "./lib/deps.mjs";
import {
  flushOutput,
  banner,
  detail,
  fail,
  info,
  ok,
  reportError,
  skip,
  step,
  warn,
} from "./lib/ui.mjs";
import { loadServerEnv, resolveMongo, scaffoldEnvFile } from "./lib/mongo.mjs";
import { describePortOwner, findFreePort, isPortFree, portHint } from "./lib/ports.mjs";
import {
  installSignalHandlers,
  isAlive,
  isShuttingDown,
  shutdownAll,
} from "./lib/proc.mjs";
import {
  logFile,
  printLogTail,
  seedDatabase,
  startApi,
  startClient,
  waitForApi,
  waitForClient,
} from "./lib/stack.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HEALTH_TIMEOUT_MS = 90000;

const HELP = `Usage: npm start -- [options]

Starts the complete Vehicle Parking System: dependency check, database, seed,
API, frontend, and the browser. Ctrl+C stops everything.

Options:
  --no-browser        Do not open the app in a browser
  --no-install        Fail instead of installing missing dependencies
  --install           Force a fresh npm ci of all three packages
  --port <number>     Preferred API port (default 5000, or $PORT)
  --client-port <n>   Preferred frontend port (default 5173, or $CLIENT_PORT)
  --host <host>       Frontend bind address (default 127.0.0.1, or $APP_HOST)
  --memory-db         Always use a temporary MongoDB for this run
  --mongo=<mode>      auto (default) | local | memory
  --keep-data         Keep data from the previous run instead of reseeding clean
  --no-seed           Skip seeding
  --smoke             Start, verify both services, then exit (used by CI)
  --verbose, -v       Stream the API and frontend logs to this terminal
  --help, -h          Show this help

When a port is busy the launcher automatically uses the next free one.
Environment variables such as PORT, CLIENT_PORT, MONGO_URI, SEED_PASSWORD and
NO_BROWSER are honoured too.`;

function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`Invalid ${label} port: ${value}`, [
      "Ports must be whole numbers between 1 and 65535.",
    ]);
  }
  return port;
}

async function resolvePort(requested, fallback, label) {
  const preferred =
    requested === undefined || requested === null || requested === ""
      ? fallback
      : parsePort(requested, label);

  if (await isPortFree(preferred)) return preferred;

  const owner = describePortOwner(preferred);
  const ownerText = owner ? ` by ${owner}` : "";
  let next;
  try {
    next = await findFreePort(preferred + 1);
  } catch (error) {
    if (error?.name === "FatalError") throw error;
    fail(`Port ${preferred} for the ${label} is already in use${ownerText}.`, [
      "Free that port or pass a different one, for example --port 5001.",
    ]);
  }

  warn(
    `Port ${preferred} for the ${label} is already in use${ownerText}; using ${next} instead.`,
  );
  const hint = portHint(preferred);
  if (hint) info(`  ${hint}`);
  return next;
}

function exitOf(child, name) {
  return new Promise((resolve) => {
    if (!isAlive(child)) {
      resolve({ name, code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => resolve({ name, code, signal }));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2), {
    command: "npm start",
    booleans: {
      "--no-browser": ["browser", false],
      "--browser": ["browser", true],
      "--no-install": ["install", false],
      "--install": ["forceInstall", true],
      "--memory-db": ["mongoMode", "memory"],
      "--keep-data": ["keepData", true],
      "--no-seed": ["seed", false],
      "--smoke": ["smoke", true],
      "--verbose": ["verbose", true],
      "-v": ["verbose", true],
      "--help": ["help", true],
      "-h": ["help", true],
    },
    values: {
      "--port": "port",
      "--client-port": "clientPort",
      "--host": "host",
      "--mongo": "mongoMode",
    },
  });

  if (options.help) {
    info(HELP);
    return 0;
  }

  // Remember which ports the user asked for on the command line / shell
  // environment, before server/.env supplies defaults.
  const requestedApiPort = options.port ?? process.env.PORT;
  const requestedClientPort = options.clientPort ?? process.env.CLIENT_PORT;

  banner("Vehicle Parking System", "local development launcher");

  step("Checking the runtime");
  const runtime = checkRuntime();
  ok(`Node.js ${runtime.node} with npm ${runtime.npm}`);

  await ensureDependencies(ROOT, {
    install: options.install !== false,
    force: options.forceInstall === true,
  });

  const envFile = scaffoldEnvFile(ROOT);
  if (envFile.created) {
    ok(`Created ${path.relative(ROOT, envFile.path)} with a generated JWT secret`);
  }
  if (envFile.missingExample) {
    warn("server/.env.example is missing, so server/.env was not created.");
  }
  loadServerEnv(ROOT);

  step("Preparing the database");
  const mongo = await resolveMongo(ROOT, { mode: options.mongoMode });

  step("Checking ports");
  const apiPort = await resolvePort(requestedApiPort, 5000, "API");
  const clientPort = await resolvePort(requestedClientPort, 5173, "frontend");
  ok(`API port ${apiPort}, frontend port ${clientPort}`);

  const bindHost = options.host || process.env.APP_HOST || "127.0.0.1";
  const urlHost = bindHost === "0.0.0.0" || bindHost === "::" ? "127.0.0.1" : bindHost;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const appUrl = `http://${urlHost}:${clientPort}`;
  const simulationUrl = `${appUrl}/dev/simulate`;
  const demoPassword = process.env.SEED_PASSWORD || "password123";

  if (options.seed !== false) {
    step("Seeding demo accounts and parking spots");
    const resetDemo = options.keepData ? false : process.env.SEED_RESET_DEMO !== "false";
    await seedDatabase(ROOT, {
      mongoUri: mongo.uri,
      resetDemo,
      demoData: process.env.SEED_DEMO_DATA !== "false",
      password: process.env.SEED_PASSWORD,
    });
    ok(
      resetDemo ? "Seeded a clean demo state" : "Seeded without resetting existing data",
    );
  } else {
    skip("Seeding skipped (--no-seed).");
  }

  step(`Starting the API on ${apiUrl}`);
  const apiLog = logFile("api");
  const api = startApi(ROOT, {
    port: apiPort,
    mongoUri: mongo.uri,
    clientUrl: appUrl,
    logFile: apiLog,
    tee: options.verbose === true,
  });
  await waitForApi(apiUrl, api, apiLog, { timeoutMs: HEALTH_TIMEOUT_MS });
  ok(`API healthy at ${apiUrl}/api/health`);

  step(`Starting the frontend on ${appUrl}`);
  const clientLog = logFile("client");
  const client = startClient(ROOT, {
    host: bindHost,
    port: clientPort,
    apiUrl,
    demoPassword,
    logFile: clientLog,
    tee: options.verbose === true,
  });
  await waitForClient(appUrl, client, clientLog, { timeoutMs: HEALTH_TIMEOUT_MS });
  ok("Frontend is serving the app");

  step("Parkwise is running");
  detail("App", appUrl);
  detail("Scenario", simulationUrl);
  detail("API", `${apiUrl}/api/health`);
  detail("Database", mongo.label);
  detail("Accounts", `entry1, entry2, exit1, exit2, admin (password: ${demoPassword})`);
  detail("Logs", apiLog);
  detail("", clientLog);

  if (options.smoke) {
    info("\n  Smoke test passed: both services started and answered health checks.");
    return 0;
  }

  info("  Press Ctrl+C to stop both services.");

  if (options.browser !== false && process.env.NO_BROWSER !== "1") {
    const opened = openUrl(appUrl);
    if (opened) {
      // A short stagger keeps some browsers from collapsing both tabs into one.
      await sleep(900);
      openUrl(simulationUrl);
    } else {
      info(
        `  Open ${appUrl} and ${simulationUrl} in your browser (no opener was found).`,
      );
    }
  }

  const exited = await Promise.race([
    exitOf(api, "backend").then((event) => ({ ...event, log: apiLog })),
    exitOf(client, "frontend").then((event) => ({ ...event, log: clientLog })),
  ]);

  if (isShuttingDown()) return 130;

  printLogTail(exited.log, exited.name);
  fail(
    `The ${exited.name} exited unexpectedly${exited.code !== null ? ` (code ${exited.code})` : ""}.`,
    ["Press Ctrl+C if a process is left over, then run `npm run doctor` for a report."],
  );
  return 1;
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
