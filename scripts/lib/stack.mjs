/**
 * Start, seed and health-check the two application processes. Shared by
 * run.mjs (the dev launcher) and check.mjs (the isolated load test).
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { waitForHttp } from "./http.mjs";
import {
  isAlive,
  killTree,
  readTail,
  runInherit,
  spawnLogged,
  waitForExit,
} from "./proc.mjs";
import { fail } from "./ui.mjs";

/** Log files live in the OS temp directory, never in the repository. */
export function logFile(name) {
  const directory = path.join(os.tmpdir(), "vehicle-parking-system", String(process.pid));
  mkdirSync(directory, { recursive: true });
  return path.join(directory, `${name}.log`);
}

export function printLogTail(logPath, label) {
  const tail = readTail(logPath, 25);
  if (!tail) return "";
  process.stderr.write(
    `\n--- last ${label} log lines (${logPath}) ---\n${tail}\n---\n\n`,
  );
  return tail;
}

function apiHints(tail) {
  const hints = [];
  if (/EADDRINUSE/i.test(tail)) {
    hints.push("Another process took the API port. Retry, or pass --port <number>.");
  }
  if (/MongoServerSelectionError|MongoNetworkError|ECONNREFUSED/i.test(tail)) {
    hints.push("The API could not reach MongoDB. Run `npm run doctor` for details.");
  }
  if (/JWT_SECRET/.test(tail)) {
    hints.push(
      "Set JWT_SECRET in server/.env (npm start generates one when it creates the file).",
    );
  }
  if (/Cannot find module/i.test(tail)) {
    hints.push("A dependency is missing. Run `npm start -- --install`.");
  }
  return hints;
}

export async function seedDatabase(
  root,
  { mongoUri, resetDemo = true, demoData = true, password } = {},
) {
  const env = {
    MONGO_URI: mongoUri,
    SEED_RESET_DEMO: resetDemo ? "true" : "false",
    SEED_DEMO_DATA: demoData ? "true" : "false",
  };
  if (password) env.SEED_PASSWORD = password;

  const result = await runInherit(
    process.execPath,
    [path.join(root, "server", "seed.js")],
    {
      cwd: path.join(root, "server"),
      env,
    },
  );

  if (result.code !== 0) {
    fail("Seeding the demo data failed.", [
      "Check that MongoDB is reachable and that server/.env is valid.",
      "Run `npm run doctor` for a full report.",
    ]);
  }
}

export function startApi(
  root,
  { port, mongoUri, clientUrl, logFile: logPath, tee = false, extraEnv = {} },
) {
  return spawnLogged({
    command: process.execPath,
    args: [path.join(root, "server", "index.js")],
    cwd: path.join(root, "server"),
    env: {
      NODE_ENV: "development",
      PORT: String(port),
      MONGO_URI: mongoUri,
      CLIENT_URL: clientUrl,
      ...extraEnv,
    },
    logFile: logPath,
    tee,
    label: "api",
  });
}

export async function waitForApi(apiUrl, child, logPath, { timeoutMs = 60000 } = {}) {
  const result = await waitForHttp(`${apiUrl}/api/health`, {
    timeoutMs,
    alive: () => isAlive(child),
    predicate: (body) => {
      try {
        const parsed = JSON.parse(body);
        return parsed.status === "ok" && parsed.database === "connected";
      } catch {
        return false;
      }
    },
  });
  if (result.ok) return;

  const tail = printLogTail(logPath, "API");
  if (result.reason === "process-exited") {
    fail("The API exited before becoming healthy.", [
      ...apiHints(tail),
      `Full log: ${logPath}`,
    ]);
  }
  fail(`The API did not become healthy within ${Math.round(timeoutMs / 1000)} seconds.`, [
    `Last response: ${result.error?.message || "none"}`,
    ...apiHints(tail),
    `Full log: ${logPath}`,
  ]);
}

export function startClient(
  root,
  { host, port, apiUrl, demoPassword, logFile: logPath, tee = false },
) {
  return spawnLogged({
    command: process.execPath,
    args: [
      path.join(root, "client", "node_modules", "vite", "bin", "vite.js"),
      "--host",
      host,
      "--port",
      String(port),
      "--strictPort",
    ],
    cwd: path.join(root, "client"),
    env: {
      VITE_API_MODE: "real",
      API_PROXY_TARGET: apiUrl,
      VITE_DEMO_PASSWORD: demoPassword,
    },
    logFile: logPath,
    tee,
    label: "web",
  });
}

export async function waitForClient(appUrl, child, logPath, { timeoutMs = 60000 } = {}) {
  const result = await waitForHttp(appUrl, {
    timeoutMs,
    alive: () => isAlive(child),
    predicate: (body) => body.includes('id="root"'),
  });
  if (result.ok) return;

  const tail = printLogTail(logPath, "frontend");
  if (result.reason === "process-exited") {
    fail("The frontend exited before serving the app.", [
      ...(/EADDRINUSE/i.test(tail)
        ? ["The frontend port is already in use. Retry."]
        : []),
      ...(/Cannot find module/i.test(tail)
        ? ["A dependency is missing. Run `npm start -- --install`."]
        : []),
      `Full log: ${logPath}`,
    ]);
  }
  fail(`The frontend did not start within ${Math.round(timeoutMs / 1000)} seconds.`, [
    `Last response: ${result.error?.message || "none"}`,
    `Full log: ${logPath}`,
  ]);
}

export async function stopChild(child, timeoutMs = 6000) {
  if (!isAlive(child)) return;
  killTree(child, "SIGTERM");
  await waitForExit(child, timeoutMs);
  if (isAlive(child)) killTree(child, "SIGKILL");
}
