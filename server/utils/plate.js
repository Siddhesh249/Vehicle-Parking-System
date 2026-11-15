"use strict";

const MAX_PLATE_LENGTH = 16;

/**
 * Canonical plate form: upper case with all whitespace and hyphens removed, so
 * "KA 01 AB 1234", "ka-01-ab-1234" and "KA01AB1234" identify the same vehicle.
 * Returns an empty string for non-string input.
 */
function normalizePlate(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

module.exports = { normalizePlate, MAX_PLATE_LENGTH };
