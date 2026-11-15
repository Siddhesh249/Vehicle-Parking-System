#!/usr/bin/env node
/**
 * Read-only environment report: what is installed, what will the launcher do,
 * and exactly how to fix anything that is missing.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import {
  dependencyState,
  isNodeSupported,
  nodeInstallHints,
  npmVersion,
  packages,
} from "./lib/deps.mjs";
import { describeOpener } from "./lib/browser.mjs";
import {
  loadServerEnv,
  mongoHints,
  pingMongo,
  redactUri,
  serverMongoUri,
} from "./lib/mongo.mjs";
import { describePortOwner, isPortFree, portHint } from "./lib/ports.mjs";
import { which } from "./lib/proc.mjs";
import { banner, bold, dim, green, info, red, reportError, yellow } from "./lib/ui.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const HELP = `Usage: npm run doctor

Prints an environment report (Node.js, npm, dependencies, MongoDB, ports,
browser opener) without changing anything. Exit code 1 means the project cannot
start until the failed rows are fixed.`;

const STATUS = {
  ok: green("ok  "),
  warn: yellow("warn"),
  fail: red("fail"),
  info: dim("info"),
};

const rows = [];

function add(group, level, label, value, fix) {
  rows.push({ group, level, label, value, fix });
}

function toolVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || "").trim().split(/\r?\n/)[0] || null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2), {
    command: "npm run doctor",
    booleans: { "--help": ["help", true], "-h": ["help", true] },
  });
  if (options.help) {
    info(HELP);
    return 0;
  }

  banner("Vehicle Parking System", "environment report");

  // Runtime -----------------------------------------------------------------
  const description = `${process.platform} ${process.arch} (${os.release()})`;
  add("Runtime", "info", "Platform", description);

  const supported = isNodeSupported();
  add(
    "Runtime",
    supported ? "ok" : "fail",
    "Node.js",
    `${process.versions.node}${supported ? "" : " (unsupported)"}`,
    supported ? null : [...nodeInstallHints()],
  );

  const npm = npmVersion();
  if (npm) {
    add("Runtime", "ok", "npm", npm);
  } else {
    add("Runtime", "fail", "npm", "not found", [
      "npm ships with Node.js; reinstall Node.js from https://nodejs.org/en/download",
      "Debian/Ubuntu: sudo apt install npm",
    ]);
  }

  const git = which("git");
  add(
    "Runtime",
    "info",
    "git",
    git ? toolVersion(git, ["--version"]) : "not installed (only needed to clone)",
  );

  // Dependencies ------------------------------------------------------------
  for (const pkg of packages()) {
    const state = dependencyState(ROOT, pkg);
    const level =
      state.status === "current" ? "ok" : state.status === "broken" ? "fail" : "warn";
    add(
      "Dependencies",
      level,
      pkg.label,
      state.reason,
      level === "ok" ? null : ["Run `npm start` to install the missing packages."],
    );
  }

  // Configuration -----------------------------------------------------------
  const envPath = path.join(ROOT, "server", ".env");
  add(
    "Configuration",
    existsSync(envPath) ? "ok" : "warn",
    "server/.env",
    existsSync(envPath) ? "present" : "missing (npm start creates it)",
  );

  let mongoUri = null;
  const serverDependenciesReady = existsSync(
    path.join(ROOT, "server", "node_modules", "mongoose", "package.json"),
  );
  if (serverDependenciesReady) {
    loadServerEnv(ROOT);
    mongoUri = serverMongoUri(ROOT);
  }
  add(
    "Configuration",
    "info",
    "MONGO_URI",
    process.env.MONGO_URI ? "set (authoritative)" : "not set (auto mode may fall back)",
  );

  // Services ---------------------------------------------------------------
  if (!serverDependenciesReady) {
    add("Services", "info", "MongoDB", "skipped (server dependencies are not installed)");
  } else {
    const ping = await pingMongo(ROOT, mongoUri, { timeoutMs: 3000 });
    if (ping.ok) {
      add("Services", "ok", "MongoDB", `reachable at ${redactUri(mongoUri)}`);
    } else if (process.env.MONGO_URI) {
      add("Services", "warn", "MongoDB", `not reachable at ${redactUri(mongoUri)}`, [
        "MONGO_URI is explicit, so npm start will stop instead of using a temporary database.",
        ...mongoHints(),
      ]);
    } else {
      add(
        "Services",
        "warn",
        "MongoDB",
        "not running (npm start will use a temporary database)",
        ["Install MongoDB only if you want data to survive a restart."],
      );
    }
  }

  const ports = [
    { label: "API", port: Number(process.env.PORT) || 5000 },
    { label: "Frontend", port: Number(process.env.CLIENT_PORT) || 5173 },
  ];
  for (const entry of ports) {
    const free = await isPortFree(entry.port);
    if (free) {
      add("Services", "ok", `${entry.label} port`, `${entry.port} free`);
    } else {
      const owner = describePortOwner(entry.port);
      add(
        "Services",
        "warn",
        `${entry.label} port`,
        `${entry.port} in use${owner ? ` by ${owner}` : ""}`,
        [portHint(entry.port) || "npm start will automatically pick the next free port."],
      );
    }
  }

  // Optional tools ---------------------------------------------------------
  const opener = describeOpener();
  add(
    "Optional tools",
    opener ? "ok" : "warn",
    "Browser opener",
    opener || "none found (npm start prints the URLs)",
  );

  const k6 = which("k6");
  add(
    "Optional tools",
    "info",
    "k6",
    k6 ? toolVersion(k6, ["version"]) : "not installed (only the optional load test)",
  );

  // Render -----------------------------------------------------------------
  let group = null;
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 8);
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      info(`\n${bold(group)}`);
    }
    info(`  ${STATUS[row.level]}  ${row.label.padEnd(labelWidth)}  ${row.value}`);
    if (row.fix) {
      for (const line of row.fix) info(`        ${dim("-")} ${dim(line)}`);
    }
  }

  const failures = rows.filter((row) => row.level === "fail").length;
  const warnings = rows.filter((row) => row.level === "warn").length;
  info("");
  info(
    `  ${failures} error${failures === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`,
  );

  if (failures > 0) {
    info("  Fix the rows marked `fail`, then run `npm start`.");
    return 1;
  }
  info("  Next step: npm start");
  return 0;
}

let exitCode = 0;
try {
  exitCode = (await main()) ?? 0;
} catch (error) {
  exitCode = reportError(error);
}
process.exit(exitCode);
