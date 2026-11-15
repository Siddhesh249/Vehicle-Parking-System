/**
 * Open a URL in the default browser using the mechanism each OS provides.
 * Failure is never fatal: the caller also prints the URLs.
 */
import { spawn } from "node:child_process";
import process from "node:process";

import { which } from "./proc.mjs";

function detector() {
  if (process.platform === "darwin") return { command: "open", args: [] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", ""] };
  if (which("xdg-open")) return { command: "xdg-open", args: [] };
  if (which("gio")) return { command: "gio", args: ["open"] };
  if (which("sensible-browser")) return { command: "sensible-browser", args: [] };
  return null;
}

/** Human-readable description for the doctor report. */
export function describeOpener() {
  const opener = detector();
  if (!opener) return null;
  return [opener.command, ...opener.args].join(" ");
}

export function openUrl(url) {
  if (process.env.NO_BROWSER === "1") return false;
  const opener = detector();
  if (!opener) return false;

  try {
    const child = spawn(opener.command, [...opener.args, url], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
