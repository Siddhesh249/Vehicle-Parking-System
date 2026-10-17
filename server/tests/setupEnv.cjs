const path = require("node:path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});

const database = process.env.MONGO_DB || "vehicle_parking";
const configuredUri = process.env.MONGO_URI;

if (configuredUri) {
  const testUri = new URL(configuredUri);
  const configuredDatabase = testUri.pathname.replace(/^\//, "");
  const testDatabase = configuredDatabase.endsWith("_test")
    ? configuredDatabase
    : `${database}_test`;
  testUri.pathname = `/${testDatabase}`;
  process.env.MONGO_URI = testUri.toString();
} else {
  const host = process.env.MONGO_HOST || "127.0.0.1";
  const port = process.env.MONGO_PORT || "27017";
  process.env.MONGO_URI = `mongodb://${host}:${port}/${database}_test`;
}
