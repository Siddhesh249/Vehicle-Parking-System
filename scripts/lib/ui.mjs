/**
 * Terminal output helpers shared by run.mjs, check.mjs and doctor.mjs.
 * Colours are only emitted for an interactive terminal and honour NO_COLOR.
 */
import process from "node:process";

const colorEnabled =
  Boolean(process.stdout.isTTY) &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  process.env.CLICOLOR !== "0";

function style(open) {
  return (text) => (colorEnabled ? `\u001b[${open}m${text}\u001b[0m` : String(text));
}

export const bold = style("1");
export const dim = style("2");
export const red = style("31");
export const green = style("32");
export const yellow = style("33");
export const cyan = style("36");

// `npm start -- --help | head` and similar pipes close stdout early. Exiting
// quietly is friendlier than crashing with an EPIPE stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => {
    if (error?.code === "EPIPE") process.exit(0);
  });
}

const accent = (text) => (colorEnabled ? `\u001b[1;31m${text}\u001b[0m` : text);
const tag = (name) => accent(`[${name}]`);

/**
 * An expected, user-facing failure. The message has already been printed when
 * `fail()` throws it, so the top-level handler does not print it twice.
 */
export class FatalError extends Error {
  constructor(message, hints = [], exitCode = 1) {
    super(message);
    this.name = "FatalError";
    this.hints = hints.filter(Boolean);
    this.exitCode = exitCode;
    this.printed = false;
  }
}

export function printError(error) {
  error.printed = true;
  process.stderr.write(`\n${tag("vps")} ${red("error:")} ${error.message}\n`);
  for (const hint of error.hints ?? []) process.stderr.write(`        ${hint}\n`);
  process.stderr.write("\n");
}

export function fail(message, hints = [], exitCode = 1) {
  const error = new FatalError(message, hints, exitCode);
  printError(error);
  throw error;
}

/** Print an error that escaped the expected-failure path (usually a bug). */
export function reportError(error) {
  if (error instanceof FatalError) {
    if (!error.printed) printError(error);
    return error.exitCode ?? 1;
  }
  printError(new FatalError(error?.stack || String(error)));
  return 1;
}

export function banner(title, subtitle) {
  process.stdout.write(`\n${accent(title)}\n`);
  if (subtitle) process.stdout.write(`${dim(subtitle)}\n`);
}

export function step(message) {
  process.stdout.write(`\n${tag("vps")} ${bold(message)}\n`);
}

export function info(message = "") {
  process.stdout.write(`${message}\n`);
}

/** Indented "label value" row used by the launcher summary and doctor. */
export function detail(label, value) {
  process.stdout.write(`  ${dim(label.padEnd(12))}${value}\n`);
}

export function ok(message) {
  process.stdout.write(`  ${green("ok")}   ${message}\n`);
}

export function skip(message) {
  process.stdout.write(`  ${yellow("skip")} ${message}\n`);
}

export function warn(message) {
  process.stderr.write(`${tag("vps")} ${yellow("warning:")} ${message}\n`);
}

/**
 * Wait until everything written to stdout/stderr has been handed to the OS.
 * Used right before process.exit() so piped output is not truncated.
 */
export async function flushOutput() {
  await Promise.all([
    new Promise((resolve) => process.stdout.write("", () => resolve())),
    new Promise((resolve) => process.stderr.write("", () => resolve())),
  ]);
}
