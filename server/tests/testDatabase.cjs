const mongoose = require("mongoose");

async function connectTestDatabase() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must point to an isolated test database");
  }
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
}

async function disconnectTestDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectTestDatabase, disconnectTestDatabase };
