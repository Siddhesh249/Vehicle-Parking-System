/**
 * Minimal argument parser used by the launcher scripts. Supports
 * `--flag`, `--key value` and `--key=value`.
 *
 * `booleans` maps a flag to the [resultKey, value] pair it should store, so an
 * option such as --no-browser can set `browser: false`.
 */
import { fail } from "./ui.mjs";

export function parseArgs(
  argv,
  { booleans = {}, values = {}, command = "npm start" } = {},
) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    let arg = argv[index];
    let inlineValue;
    const equals = arg.indexOf("=");
    if (arg.startsWith("--") && equals !== -1) {
      inlineValue = arg.slice(equals + 1);
      arg = arg.slice(0, equals);
    }

    if (Object.prototype.hasOwnProperty.call(booleans, arg)) {
      if (inlineValue !== undefined) {
        fail(`Option ${arg} does not take a value.`, [
          `Run \`${command} -- --help\` to see the available options.`,
        ]);
      }
      const [key, value] = booleans[arg];
      result[key] = value;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(values, arg)) {
      const value = inlineValue ?? argv[++index];
      if (value === undefined || value === "") {
        fail(`Option ${arg} needs a value.`, [
          `Run \`${command} -- --help\` to see the available options.`,
        ]);
      }
      result[values[arg]] = value;
      continue;
    }

    fail(`Unknown option: ${arg}`, [
      `Run \`${command} -- --help\` to see the available options.`,
    ]);
  }

  return result;
}
