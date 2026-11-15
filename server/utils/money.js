"use strict";

/** Round a currency amount to paise (two decimal places). */
function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = { roundMoney };
