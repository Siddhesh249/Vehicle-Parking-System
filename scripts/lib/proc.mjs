/**
 * Child-process helpers that behave the same on Windows, macOS and Linux.
 * Long-running children are tracked so Ctrl+C (and crashes) never leave
 * orphaned node/esbuild/mongod processes behind.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

export const isWindows = process.platform === "win32";

const activeChildren = new Set();
const shutdownTasks = [];
let shuttingDown = false;
let cleanupStarted = false;

export function isShuttingDown() {
  return shuttingDown;
}

export function isAlive(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

function trackChild(child) {
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  return child;
}

/** Register an async task (e.g. stopping the temporary MongoDB) for shutdown. */
export function onShutdown(task) {
  shutdownTasks.push(task);
}

/**
 * Last-resort synchronous cleanup for hard exits: Node cannot await anything
 * from an "exit" handler, so signal the pid directly.
 */
export function registerExitKill(pid) {
  if (!pid) return;
  process.on("exit", () => {
    try {
      if (isWindows) {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch {
      // The process is already gone; nothing to do.
    }
  });
}

/** Locate an executable on PATH without invoking a shell. */
export function which(command) {
  const rawPath = process.env.PATH || process.env.Path || "";
  const extensions = isWindows
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  const names = path.extname(command)
    ? [command]
    : extensions.map((extension) => command + extension);

  for (const directory of rawPath.split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Terminate a child and everything it spawned. */
export function killTree(child, signal = "SIGTERM") {
  if (!isAlive(child)) return;
  const pid = child.pid;
  if (!pid) return;

  if (isWindows) {
    // taskkill /T walks the process tree, which is what kills Vite's esbuild
    // helper and node --watch children on Windows.
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Ignore: the process may have exited between the checks.
    }
    return;
  }

  try {
    // Children are started detached, so the pid is a process-group leader.
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Ignore: the process may have exited between the checks.
    }
  }
}

export function waitForExit(child, timeoutMs = 5000) {
  if (!isAlive(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      child.off("exit", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    child.once("exit", done);
  });
}

/** Give tracked children a chance to shut down, then force-kill the rest. */
export async function stopChildren(timeoutMs = 6000) {
  const children = [...activeChildren];
  if (children.length === 0) return;

  for (const child of children) killTree(child, "SIGTERM");
  await Promise.all(children.map((child) => waitForExit(child, timeoutMs)));
  for (const child of children) {
    if (isAlive(child)) killTree(child, "SIGKILL");
  }
}

/** Stop children and run every registered shutdown task exactly once. */
export async function shutdownAll() {
  if (cleanupStarted) return;
  cleanupStarted = true;

  await stopChildren();
  while (shutdownTasks.length > 0) {
    const task = shutdownTasks.pop();
    try {
      await task();
    } catch {
      // Cleanup is best-effort; never mask the original failure.
    }
  }
}

/** Translate Ctrl+C / SIGTERM into a graceful shutdown with the usual exit code. */
export function installSignalHandlers() {
  const handle = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write("\n");
    void (async () => {
      await shutdownAll();
      process.exit(code);
    })();
  };

  process.on("SIGINT", () => handle(130));
  process.on("SIGTERM", () => handle(143));
  if (isWindows) process.on("SIGBREAK", () => handle(130));
  else process.on("SIGHUP", () => handle(129));

  // If the process dies unexpectedly, at least do not leak children.
  process.on("exit", () => {
    for (const child of activeChildren) killTree(child, "SIGKILL");
  });
}

/** Run a command with inherited stdio and resolve with its exit code. */
export function runInherit(command, args, { cwd, env, shell = false } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell,
    windowsHide: true,
  });
  trackChild(child);

  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, signal: null, error }));
    child.once("exit", (code, signal) =>
      resolve({ code: code ?? (signal ? 128 : 1), signal, error: null }),
    );
  });
}

/**
 * Like runInherit, but keeps the last 64 KB of output so a failed npm install
 * can be explained instead of just dumped.
 */
export function runStreamed(
  command,
  args,
  { cwd, env, echo = true, shell = false } = {},
) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell,
    windowsHide: true,
  });
  trackChild(child);

  let output = "";
  const collect = (chunk) => {
    output = (output + chunk.toString()).slice(-65536);
    if (echo) process.stdout.write(chunk);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  return new Promise((resolve) => {
    child.once("error", (error) =>
      resolve({ code: 1, signal: null, output: `${output}${error.message}`, error }),
    );
    child.once("exit", (code, signal) =>
      resolve({ code: code ?? (signal ? 128 : 1), signal, output, error: null }),
    );
  });
}

/**
 * Start a long-running process, streaming its output to a log file.
 * `tee` also mirrors the output to this terminal (used with --verbose).
 */
export function spawnLogged({
  command,
  args,
  cwd,
  env,
  logFile,
  tee = false,
  label = "process",
}) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = createWriteStream(logFile, { flags: "w" });
  let streamClosed = false;
  const closeStream = () => {
    if (streamClosed) return;
    streamClosed = true;
    stream.end();
  };

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // On POSIX this makes the child a process-group leader so killTree can take
    // down its whole tree. On Windows taskkill /T handles that instead, and
    // detached:true would open a second console window.
    detached: !isWindows,
    windowsHide: true,
  });
  trackChild(child);

  child.stdout.on("data", (chunk) => {
    stream.write(chunk);
    if (tee) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stream.write(chunk);
    if (tee) process.stderr.write(chunk);
  });
  child.once("error", (error) => {
    stream.write(`[${label}] failed to start: ${error.message}\n`);
    closeStream();
  });
  child.once("exit", closeStream);

  return child;
}

/** Read the last N lines of a file without loading the whole thing. */
export function readTail(file, lineCount = 25) {
  if (!existsSync(file)) return "";
  const stats = statSync(file);
  const size = Math.min(stats.size, 256 * 1024);
  if (size === 0) return "";

  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(size);
  try {
    readSync(fd, buffer, 0, size, stats.size - size);
  } finally {
    closeSync(fd);
  }

  const lines = buffer.toString("utf8").split(/\r?\n/);
  return lines
    .slice(Math.max(0, lines.length - lineCount))
    .join("\n")
    .trimEnd();
}
