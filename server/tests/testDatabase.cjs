const mongoose = require("mongoose");

let memoryServer = null;

async function connectWithUri(uri) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
}

/**
 * Connect to the isolated test database. CI supplies a MongoDB service, while
 * a developer machine may not have a local MongoDB running at all; in that
 * case fall back to an in-process mongodb-memory-server instance so the Jest
 * suite remains self-contained.
 */
async function connectTestDatabase() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must point to an isolated test database");
  }

  try {
    await connectWithUri(process.env.MONGO_URI);
    return;
  } catch (error) {
    await mongoose.disconnect().catch(() => {});
    const { MongoMemoryServer } = require("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create();
    await connectWithUri(memoryServer.getUri());
    console.warn(
      `Local MongoDB unavailable (${error.message}); using an in-memory test database.`,
    );
  }
}

async function disconnectTestDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = { connectTestDatabase, disconnectTestDatabase };
