require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { server } = require("./app");

async function start() {
  const user = encodeURIComponent(process.env.MONGO_USER || "");
  const password = encodeURIComponent(process.env.MONGO_PASSWORD || "");
  const host = process.env.MONGO_HOST || "127.0.0.1";
  const port = process.env.MONGO_PORT || "27017";
  const database = process.env.MONGO_DB || "vehicle_parking";
  const authDatabase = encodeURIComponent(
    process.env.MONGO_AUTH_DB || "vehicle_parking"
  );

  if (!user || !password) {
    throw new Error("MongoDB credentials are missing from server/.env");
  }

  const mongoUri =
    `mongodb://${user}:${password}@${host}:${port}/${database}` +
    `?authSource=${authDatabase}`;

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const serverPort = Number(process.env.PORT) || 5000;

  server.listen(serverPort, "127.0.0.1", () => {
    console.log(`API listening at http://127.0.0.1:${serverPort}`);
  });
}

start().catch((error) => {
  console.error("Backend startup failed:", error.message);
  process.exit(1);
});
