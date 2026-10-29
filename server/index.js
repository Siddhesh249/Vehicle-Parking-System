require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { server } = require("./app");
const { getMongoUri } = require("./utils/database");

async function start() {
  await mongoose.connect(getMongoUri());
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
