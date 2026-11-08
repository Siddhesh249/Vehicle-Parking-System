require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { server, io } = require("./app");
const { getMongoUri } = require("./utils/database");
const { scanOverstays } = require("./services/overstayService");

const OVERSTAY_SCAN_INTERVAL_MS = Number(process.env.OVERSTAY_SCAN_INTERVAL_MS) || 30000;
let overstayTimer = null;
let shuttingDown = false;

async function scanAndBroadcastOverstays() {
  try {
    const alerts = await scanOverstays();
    for (const alert of alerts) io.to("admin").emit("overstay:alert", alert);
  } catch (error) {
    // A transient scan failure must not take down the API; the next interval
    // tries again and the admin dashboard can still read /api/admin/overstays.
    console.error("Overstay scan failed:", error.message);
  }
}

function startOverstayScanner() {
  if (overstayTimer) return overstayTimer;
  overstayTimer = setInterval(
    () => void scanAndBroadcastOverstays(),
    OVERSTAY_SCAN_INTERVAL_MS,
  );
  if (typeof overstayTimer.unref === "function") overstayTimer.unref();
  void scanAndBroadcastOverstays();
  return overstayTimer;
}

function stopOverstayScanner() {
  if (overstayTimer) clearInterval(overstayTimer);
  overstayTimer = null;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down...`);
  stopOverstayScanner();

  await new Promise((resolve) => {
    if (!server.listening) return resolve();
    return server.close((error) => {
      if (error) console.error("HTTP server close failed:", error.message);
      resolve();
    });
  });

  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

async function start() {
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured in production");
  }
  await mongoose.connect(getMongoUri());
  console.log("Connected to MongoDB");

  const serverPort = Number(process.env.PORT) || 5000;

  server.listen(serverPort, "127.0.0.1", () => {
    console.log(`API listening at http://127.0.0.1:${serverPort}`);
    startOverstayScanner();
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((error) => {
  console.error("Backend startup failed:", error.message);
  process.exit(1);
});
