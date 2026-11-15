/**
 * Cross-platform port checks. The old shell scripts used `ss`, which does not
 * exist on macOS or Windows; probing with a real listen() works everywhere and
 * matches what Node itself will do.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";
import { fail } from "./ui.mjs";

export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** Find the first free port at or after `preferred`. */
export async function findFreePort(preferred, host = "127.0.0.1", attempts = 100) {
  for (let port = preferred; port < preferred + attempts && port <= 65535; port += 1) {
    if (await isPortFree(port, host)) return port;
  }
  fail(`No free port found near ${preferred}.`, [
    "Stop some local services or pass a different --port value.",
  ]);
}

/**
 * Best-effort "who owns this port" lookup for a helpful error message.
 * Runs only after a port is known to be busy, so the cost does not matter.
 */
export function describePortOwner(port) {
  try {
    if (process.platform === "win32") {
      const netstat = spawnSync("netstat", ["-ano"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const line = (netstat.stdout || "")
        .split(/\r?\n/)
        .find((entry) => entry.includes(`:${port}`) && /LISTENING/i.test(entry));
      if (!line) return null;
      const pid = line.trim().split(/\s+/).pop();
      const tasklist = spawnSync(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        {
          encoding: "utf8",
          windowsHide: true,
        },
      );
      const name = (tasklist.stdout || "").split(",")[0]?.replace(/"/g, "").trim();
      return name ? `${name} (PID ${pid})` : `PID ${pid}`;
    }

    const lsof = spawnSync(
      "lsof",
      ["-nP", "-F", "pcn", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf8" },
    );
    if (lsof.status === 0 && lsof.stdout) {
      let pid = null;
      let command = null;
      for (const line of lsof.stdout.split("\n")) {
        if (line.startsWith("p")) pid = line.slice(1);
        else if (line.startsWith("c")) command = line.slice(1);
      }
      if (pid) return `${command || "process"} (PID ${pid})`;
    }

    const ss = spawnSync("ss", ["-ltnp", `sport = :${port}`], { encoding: "utf8" });
    if (ss.status === 0) {
      const match = /users:\(\("([^"]+)",pid=(\d+)/.exec(ss.stdout);
      if (match) return `${match[1]} (PID ${match[2]})`;
    }
  } catch {
    // Owner lookup is a nicety; never fail because of it.
  }
  return null;
}

/** Platform-specific advice for a busy port. */
export function portHint(port) {
  if (process.platform === "darwin" && port === 5000) {
    return "macOS AirPlay Receiver listens on port 5000. Turn it off under System Settings > General > AirDrop & Handoff, or keep the automatically chosen port.";
  }
  return null;
}
