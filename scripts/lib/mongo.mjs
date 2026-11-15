/**
 * MongoDB handling for the launcher.
 *
 * Modes:
 *   auto    - use the configured local MongoDB when it answers, otherwise start
 *             a temporary MongoDB for this run (data is discarded on exit)
 *   local   - require the configured MongoDB
 *   memory  - always start the temporary MongoDB
 *
 * The "temporary" database is a real mongod process managed by
 * mongodb-memory-server (already a server devDependency used by the tests), so
 * every query, index and atomic update behaves exactly like a normal install.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { onShutdown, registerExitKill } from "./proc.mjs";
import { fail, info, ok, warn } from "./ui.mjs";

const MODES = ["auto", "local", "memory"];

function serverRequire(root) {
  return createRequire(path.join(root, "server", "package.json"));
}

export function redactUri(uri) {
  return String(uri).replace(/\/\/([^:/@]+):([^@]*)@/, "//$1:***@");
}

/** Replace the database name in a MongoDB URI while keeping credentials. */
export function withDatabase(uri, database) {
  try {
    const url = new URL(uri);
    url.pathname = `/${database}`;
    return url.toString();
  } catch {
    return uri;
  }
}

/** Create server/.env from the example plus a generated JWT secret. */
export function scaffoldEnvFile(root) {
  const target = path.join(root, "server", ".env");
  if (existsSync(target)) return { created: false, path: target };

  const examplePath = path.join(root, "server", ".env.example");
  if (!existsSync(examplePath)) {
    return { created: false, path: target, missingExample: true };
  }

  const template = readFileSync(examplePath, "utf8").trimEnd();
  const content = [
    "# Local development configuration created by `npm start`.",
    "# This file is git-ignored; edit it freely.",
    "",
    template,
    "",
    "# Generated once by the launcher. Replace it with your own long random value if you like.",
    `JWT_SECRET=${randomBytes(32).toString("hex")}`,
    "",
  ].join("\n");

  try {
    writeFileSync(target, content, { flag: "wx" });
    return { created: true, path: target };
  } catch {
    // Another process created it first; use that file.
    return { created: false, path: target };
  }
}

/** Load server/.env into process.env without overriding existing variables. */
export function loadServerEnv(root) {
  const envPath = path.join(root, "server", ".env");
  if (!existsSync(envPath)) return { path: envPath, loaded: false };

  const dotenv = serverRequire(root)("dotenv");
  const result = dotenv.config({ path: envPath, quiet: true });
  return { path: envPath, loaded: !result.error, error: result.error };
}

export function serverMongoUri(root) {
  const { getMongoUri } = serverRequire(root)("./utils/database");
  return getMongoUri();
}

export function mongoHints() {
  const hints = [];
  if (process.platform === "darwin") {
    hints.push(
      "macOS:  brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community",
    );
  } else if (process.platform === "win32") {
    hints.push("Windows: winget install MongoDB.Server");
    hints.push(
      "         or the MSI from https://www.mongodb.com/try/download/community, then: net start MongoDB",
    );
  } else {
    hints.push(
      "Linux:  sudo systemctl start mongod   (or: sudo systemctl enable --now mongod)",
    );
    hints.push(
      "         install guide: https://www.mongodb.com/docs/manual/administration/install-on-linux/",
    );
  }
  hints.push("Docker: docker run -d --name vps-mongo -p 27017:27017 mongo:8.2");
  hints.push("Or use a temporary database for one run: npm start -- --memory-db");
  return hints;
}

/** Connect once and disconnect again; returns a result object instead of throwing. */
export async function pingMongo(root, uri, { timeoutMs = 4000 } = {}) {
  let mongoose;
  try {
    mongoose = serverRequire(root)("mongoose");
  } catch {
    return { ok: false, error: new Error("server dependencies are not installed") };
  }

  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: timeoutMs,
    connectTimeoutMS: timeoutMs,
  });
  // asPromise() reports the failure; this listener avoids an unhandled event.
  connection.on("error", () => {});

  try {
    await connection.asPromise();
    await connection.close();
    return { ok: true };
  } catch (error) {
    await connection.close().catch(() => {});
    return { ok: false, error };
  }
}

/** Drop a database (used by the isolated load-test run). */
export async function dropDatabase(root, uri) {
  const mongoose = serverRequire(root)("mongoose");
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  connection.on("error", () => {});
  try {
    await connection.asPromise();
    await connection.dropDatabase();
  } finally {
    await connection.close().catch(() => {});
  }
}

/**
 * mongodb-memory-server keeps downloaded binaries in ~/.cache/mongodb-binaries
 * unless MONGOMS_DOWNLOAD_DIR says otherwise. Showing the "first run downloads"
 * notice only when that cache is empty avoids a misleading message.
 */
function memoryBinaryCached() {
  const directory =
    process.env.MONGOMS_DOWNLOAD_DIR ||
    path.join(os.homedir(), ".cache", "mongodb-binaries");
  try {
    return readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}

async function startMemoryMongo(root, { database = "vehicle_parking", reason } = {}) {
  const requireFromServer = serverRequire(root);
  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = requireFromServer("mongodb-memory-server"));
  } catch {
    fail(
      "mongodb-memory-server is not installed, so the temporary database cannot start.",
      ["Run `npm start` again so server dependencies are installed.", ...mongoHints()],
    );
  }

  if (reason) {
    warn(`No MongoDB is reachable at ${redactUri(reason)}.`);
  }
  info("  Starting a temporary MongoDB for this run (data is discarded when it stops).");
  if (!process.env.MONGOMS_SYSTEM_BINARY && !memoryBinaryCached()) {
    info("  The first run downloads a MongoDB binary (~100 MB) to your user cache.");
  }

  let mongod;
  try {
    mongod = await MongoMemoryServer.create();
  } catch (error) {
    fail(`Could not start the temporary MongoDB: ${error.message}`, [
      "The first run needs internet access to download the MongoDB binary.",
      "Official MongoDB binaries need glibc; Alpine/musl Linux is not supported.",
      "Check free disk space and write access to your home directory.",
      ...mongoHints(),
    ]);
  }

  const uri = mongod.getUri(database);
  const pid = mongod.instanceInfo?.pid;
  if (pid) registerExitKill(pid);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    // Do not let a wedged mongod block Ctrl+C; the exit hook force-kills the pid.
    await Promise.race([
      mongod.stop(),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 10000);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  };
  onShutdown(stop);

  return {
    kind: "memory",
    uri,
    label: "temporary MongoDB (data is discarded on exit)",
    stop,
  };
}

/**
 * Resolve which database this run should use. `database` overrides the database
 * name (the load test uses an isolated one).
 */
export async function resolveMongo(root, { mode, database } = {}) {
  const selected = String(mode ?? process.env.VPS_MONGO_MODE ?? "auto").toLowerCase();
  if (!MODES.includes(selected)) {
    fail(`Unknown MongoDB mode: ${selected}`, [
      "Use --mongo=auto, --mongo=local or --mongo=memory (or --memory-db).",
    ]);
  }

  if (selected === "memory") {
    return startMemoryMongo(root, { database: database || "vehicle_parking" });
  }

  const baseUri = serverMongoUri(root);
  const uri = database ? withDatabase(baseUri, database) : baseUri;
  const result = await pingMongo(root, uri);

  if (result.ok) {
    ok(`Using MongoDB at ${redactUri(uri)}`);
    return {
      kind: "local",
      uri,
      label: `local MongoDB at ${redactUri(uri)}`,
      stop: async () => {},
    };
  }

  if (selected === "local") {
    fail(
      `MongoDB is not reachable at ${redactUri(uri)}: ${result.error.message}`,
      mongoHints(),
    );
  }

  // An explicit MONGO_URI is treated as authoritative: silently switching
  // databases would look like data loss to the user.
  if (process.env.MONGO_URI) {
    fail(`MongoDB is not reachable at ${redactUri(uri)}: ${result.error.message}`, [
      "MONGO_URI is set, so the launcher will not silently use another database.",
      "Fix the URI (or remove it) and retry, or run with --memory-db to use a temporary database.",
      ...mongoHints(),
    ]);
  }

  return startMemoryMongo(root, {
    database: database || process.env.MONGO_DB || "vehicle_parking",
    reason: uri,
  });
}
