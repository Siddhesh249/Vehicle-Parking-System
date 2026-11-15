/**
 * Runtime and dependency checks.
 *
 * Node.js is the single hard prerequisite. Everything else (npm, packages,
 * MongoDB) is verified here with an actionable message instead of a stack
 * trace. npm is run through Node's own npm-cli.js where possible, because
 * spawning npm.cmd directly needs a shell on Windows.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { isWindows, runStreamed } from "./proc.mjs";
import { fail, ok, step, warn } from "./ui.mjs";

const PACKAGES = [
  { key: "root", directory: ".", label: "root", sentinel: "prettier" },
  { key: "server", directory: "server", label: "server", sentinel: "mongoose" },
  { key: "client", directory: "client", label: "client", sentinel: "vite" },
];

export function packages() {
  return PACKAGES;
}

export function isNodeSupported(version = process.versions.node) {
  const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10));
  if (major > 22) return true;
  if (major === 22) return minor >= 12;
  if (major === 20) return minor >= 19;
  return false;
}

export function nodeInstallHints() {
  if (process.platform === "win32") {
    return [
      "Windows:  winget install OpenJS.NodeJS.LTS",
      "          or install the LTS build from https://nodejs.org/en/download",
      "          then close and reopen your terminal.",
    ];
  }
  if (process.platform === "darwin") {
    return [
      "macOS:    brew install node   (Homebrew's latest release; 22.12+ is supported)",
      "          or install the LTS build from https://nodejs.org/en/download",
      "          with nvm: nvm install 24 && nvm use 24",
    ];
  }
  return [
    "Linux:    install Node.js 24 from https://nodejs.org/en/download",
    "          with nvm: nvm install 24 && nvm use 24",
    "          Debian/Ubuntu: sudo apt install nodejs npm (check that node -v is 20.19+)",
  ];
}

function npmMissingHints() {
  return [
    ...nodeInstallHints(),
    "Reinstalling Node.js from nodejs.org also restores the npm that ships with it.",
    "Debian/Ubuntu sometimes splits them: sudo apt install npm",
    "Arch: sudo pacman -S npm",
  ];
}

/** npm ships inside the Node installation; find its CLI entry point. */
export function resolveNpmCli() {
  const nodeDirectory = path.dirname(process.execPath);
  const candidates = [
    // Windows official installer layout.
    path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    // POSIX, nvm, Homebrew and most distro layouts.
    path.join(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDirectory, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function npmInvocation() {
  const cli = resolveNpmCli();
  if (cli) return { command: process.execPath, args: [cli], shell: false };
  // Fallback for unusual installs: npm.cmd must run through a shell on Windows.
  return {
    command: isWindows ? "npm.cmd" : "npm",
    args: [],
    shell: isWindows,
  };
}

export function npmVersion() {
  const npm = npmInvocation();
  const result = spawnSync(npm.command, [...npm.args, "--version"], {
    encoding: "utf8",
    shell: npm.shell,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

/** Throwing variant used by run.mjs and check.mjs. */
export function checkRuntime() {
  if (!isNodeSupported()) {
    fail(`Node.js ${process.versions.node} is not supported by this project.`, [
      "This project needs Node.js 20.19+, 22.12+, or 24 LTS (24 LTS is recommended).",
      ...nodeInstallHints(),
    ]);
  }
  if (Number.parseInt(process.versions.node.split(".")[0], 10) < 24) {
    warn(`Node.js ${process.versions.node} works, but Node.js 24 LTS is recommended.`);
  }

  const version = npmVersion();
  if (!version) {
    fail("npm was not found next to your Node.js installation.", npmMissingHints());
  }
  if (Number.parseInt(version.split(".")[0], 10) < 9) {
    fail(`npm ${version} is too old; this project needs npm 9 or newer.`, [
      "Install a current Node.js LTS build from https://nodejs.org/en/download.",
    ]);
  }

  return { node: process.versions.node, npm: version, npmCommand: npmInvocation() };
}

function lockHash(lockPath) {
  return createHash("sha256").update(readFileSync(lockPath)).digest("hex");
}

/**
 * Has every package been installed for this exact lockfile, Node major version
 * and platform? A sentinel module catches half-finished installs, which a plain
 * "does node_modules exist" check cannot.
 */
export function dependencyState(root, pkg) {
  const lockPath = path.join(root, pkg.directory, "package-lock.json");
  const moduleDirectory = path.join(root, pkg.directory, "node_modules");
  const stampPath = path.join(moduleDirectory, ".vps-install.json");

  if (!existsSync(lockPath)) {
    return { status: "broken", reason: "package-lock.json is missing" };
  }
  if (!existsSync(path.join(moduleDirectory, pkg.sentinel, "package.json"))) {
    return { status: "missing", reason: "dependencies are not installed" };
  }
  if (!existsSync(stampPath)) {
    return { status: "stale", reason: "installed without an install stamp" };
  }

  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return { status: "stale", reason: "the install stamp is unreadable" };
  }

  if (stamp.lock !== lockHash(lockPath)) {
    return {
      status: "stale",
      reason: "package-lock.json changed since the last install",
    };
  }
  if (stamp.node !== process.versions.node.split(".")[0]) {
    return { status: "stale", reason: "installed for a different Node.js version" };
  }
  if (stamp.platform !== process.platform || stamp.arch !== process.arch) {
    return { status: "stale", reason: "installed for a different platform" };
  }
  return { status: "current", reason: "up to date" };
}

function explainNpmFailure(directory, output) {
  const hints = [];
  if (/EUSAGE|lock file|lockfile|Missing: .* from lock file/i.test(output)) {
    hints.push("package-lock.json is out of sync with package.json.");
    hints.push(
      `Run \`npm install\` inside ${directory}, review the diff, and commit the lockfile.`,
    );
  } else if (
    /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network/i.test(output)
  ) {
    hints.push(
      "npm could not reach the package registry. Check your internet connection, VPN, or proxy (npm config get proxy).",
    );
  } else if (/EACCES|EPERM/i.test(output)) {
    hints.push(`npm cannot write to ${directory}.`);
    hints.push("Fix the folder ownership; do not run this project with sudo.");
  } else if (/EBADENGINE/i.test(output)) {
    hints.push(
      "A dependency requires a different Node.js version. Node.js 24 LTS is recommended.",
    );
  } else if (/ENOSPC/i.test(output)) {
    hints.push("The disk is full. Free some space and retry.");
  } else if (/integrity checksum/i.test(output)) {
    hints.push(
      `Delete ${path.join(directory, "node_modules")} and retry with npm start -- --install.`,
    );
  }

  const tail = output.trim().split(/\r?\n/).slice(-12);
  if (tail.length > 0) {
    hints.push("Last lines from npm:");
    hints.push(...tail);
  }
  return hints;
}

/**
 * Install all three packages with `npm ci` when their lockfile, Node version or
 * platform changed. `install: false` turns this into a pure verification step.
 */
export async function ensureDependencies(root, { force = false, install = true } = {}) {
  const npm = npmInvocation();

  for (const pkg of PACKAGES) {
    const state = dependencyState(root, pkg);
    if (!force && state.status === "current") {
      ok(`${pkg.label} dependencies: ${state.reason}`);
      continue;
    }

    if (!install) {
      fail(`${pkg.label} dependencies are not ready (${state.reason}).`, [
        "Run `npm start` (or `npm ci`) without --no-install to install them.",
      ]);
    }

    const directory = path.join(root, pkg.directory);
    step(`Installing ${pkg.label} dependencies`);
    const result = await runStreamed(
      npm.command,
      [...npm.args, "ci", "--include=dev", "--no-audit", "--no-fund"],
      { cwd: directory, echo: true, shell: npm.shell },
    );

    if (result.code !== 0) {
      fail(
        `Installing ${pkg.label} dependencies failed.`,
        explainNpmFailure(directory, result.output),
      );
    }

    if (!existsSync(path.join(directory, "node_modules"))) {
      fail(`npm finished but ${pkg.label}/node_modules was not created.`, [
        "Retry with: npm start -- --install",
      ]);
    }

    writeFileSync(
      path.join(directory, "node_modules", ".vps-install.json"),
      `${JSON.stringify(
        {
          lock: lockHash(path.join(directory, "package-lock.json")),
          node: process.versions.node.split(".")[0],
          platform: process.platform,
          arch: process.arch,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    ok(`${pkg.label} dependencies installed`);
  }
}
