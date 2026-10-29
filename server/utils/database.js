"use strict";

/**
 * Build the MongoDB URI from the same environment variables used by the server.
 * Tests override this with their isolated MONGO_URI in tests/setupEnv.cjs.
 */
function getMongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;

  const user = encodeURIComponent(process.env.MONGO_USER || "");
  const password = encodeURIComponent(process.env.MONGO_PASSWORD || "");
  const host = process.env.MONGO_HOST || "127.0.0.1";
  const port = process.env.MONGO_PORT || "27017";
  const database = process.env.MONGO_DB || "vehicle_parking";
  const authDatabase = encodeURIComponent(process.env.MONGO_AUTH_DB || "vehicle_parking");

  if (user && password) {
    return `mongodb://${user}:${password}@${host}:${port}/${database}?authSource=${authDatabase}`;
  }
  return `mongodb://${host}:${port}/${database}`;
}

module.exports = { getMongoUri };
