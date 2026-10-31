require("dotenv").config({ quiet: true });

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { login } = require("./services/loginService");
const { allocateSpot } = require("./services/allocationService");
const {
  lookupByTicket,
  searchByPlate,
  processExit,
} = require("./services/fareExitService");
const { getOccupancy, getRevenue } = require("./services/analyticsService");
const { listTransactions, listAuditEntries } = require("./services/adminQueryService");
const { updateFareTiers, updateSpotCount } = require("./services/adminConfigService");
const { notifyOverstay, forceRelease } = require("./services/overstayService");
const { requireRole } = require("./middleware/authMiddleware");
const { verifyToken } = require("./utils/jwtUtils");
const {
  startSimulation,
  stopSimulation,
  getSimulationState,
  setFareOverride,
} = require("./services/simulationService");
const Spot = require("./models/Spot");

const app = express();
const server = http.createServer(app);

const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors({ origin: clientUrl }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: clientUrl,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

function socketRoomFor(user) {
  return user.role === "admin" ? "admin" : `gate:${user.gateId}`;
}

function percentage(part, whole) {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

/** Build the full lot state shared by GET /api/lot/status and lot:snapshot. */
async function buildLotSnapshot({ zone } = {}) {
  const filter = zone ? { zone } : {};
  const spots = await Spot.find(filter, { spotNumber: 1, zone: 1, status: 1 })
    .sort({ zone: 1, spotNumber: 1 })
    .lean();

  const byZone = {
    "2W": { occupied: 0, total: 0, pct: 0 },
    "4W": { occupied: 0, total: 0, pct: 0 },
  };
  for (const spot of spots) {
    const summary = byZone[spot.zone];
    if (!summary) continue;
    summary.total += 1;
    if (spot.status === "reserved") summary.occupied += 1;
  }
  for (const summary of Object.values(byZone)) {
    summary.pct = percentage(summary.occupied, summary.total);
  }

  const occupied = spots.filter((spot) => spot.status === "reserved").length;
  return {
    spots: spots.map((spot) => ({
      id: String(spot._id),
      spotNumber: spot.spotNumber,
      zone: spot.zone,
      status: spot.status,
    })),
    occupancy: {
      totalPct: percentage(occupied, spots.length),
      occupied,
      totalSpots: spots.length,
      byZone,
    },
  };
}

async function sendLotSnapshot(socket) {
  socket.emit("lot:snapshot", await buildLotSnapshot());
}

function broadcastSpotUpdate(spotId, status) {
  io.to("authenticated").emit("spot:update", { spotId: String(spotId), status });
}

// A snapshot makes late or reconnecting clients converge even if they missed
// an incremental spot:update. Keep it off the request path: the mutation has
// already committed and clients still get the event immediately.
function broadcastLotSnapshot() {
  if (mongoose.connection.readyState !== 1) return;
  buildLotSnapshot()
    .then((snapshot) => io.to("authenticated").emit("lot:snapshot", snapshot))
    .catch(() => {});
}

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "A valid Bearer token is required" },
    });
  }

  try {
    req.user = verifyToken(authorization.slice(7));
    return next();
  } catch (_error) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
    });
  }
}

function requireGate(gatePrefix) {
  return (req, res, next) => {
    const { role, gateId } = req.user || {};
    if (role !== "operator" || !gateId || !gateId.startsWith(gatePrefix)) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "This operator is not authorized for this gate",
        },
      });
    }
    return next();
  };
}

function sendServiceError(res, error) {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const code = error.code || "INTERNAL_ERROR";
  const message = status === 500 ? "An unexpected server error occurred" : error.message;
  return res.status(status).json({ error: { code, message } });
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// Sprint 3 T4: the lot map loads its initial state over REST, then live updates
// keep every session in sync (VPS-F-020, VPS-F-022).
app.get("/api/lot/status", authenticateToken, async (req, res) => {
  const { zone } = req.query;
  if (zone !== undefined && !["2W", "4W"].includes(zone)) {
    return res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "zone must be either '2W' or '4W'" },
    });
  }
  try {
    return res.status(200).json(await buildLotSnapshot({ zone }));
  } catch (error) {
    return sendServiceError(res, error);
  }
});


// Sprint 4 T2: developer-only simulation controls. Never expose in production.
function requireDevelopmentMode(req, res, next) {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  }
  return next();
}

app.get("/api/dev/simulate/status", requireDevelopmentMode, (_req, res) => {
  return res.status(200).json(getSimulationState());
});

app.post("/api/dev/simulate/start", requireDevelopmentMode, (req, res) => {
  try {
    return res.status(200).json(startSimulation({ ratePerMinute: req.body?.ratePerMinute }));
  } catch (error) {
    return sendServiceError(res, error);
  }
});

app.post("/api/dev/simulate/stop", requireDevelopmentMode, (_req, res) => {
  return res.status(200).json(stopSimulation());
});

app.put("/api/dev/simulate/fare-tiers", requireDevelopmentMode, (req, res) => {
  try {
    return res.status(200).json(setFareOverride(req.body || {}));
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      error: { code: error.code || "INVALID_FARE_OVERRIDE", message: error.message },
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    return res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "Username and password are required" },
    });
  }

  try {
    const result = await login(username.trim(), password);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 401;
    const code = status === 423 ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS";
    return res.status(status).json({ error: { code, message: error.message } });
  }
});

// Sprint 3 T1: entry allocation API.
app.post(
  "/api/entry/vehicles",
  authenticateToken,
  requireGate("Entry-"),
  async (req, res) => {
    try {
      const result = await allocateSpot({
        plateNumber: req.body?.plateNumber,
        vehicleType: req.body?.vehicleType,
        gateId: req.user.gateId,
        operatorId: req.user.userId,
      });
      broadcastSpotUpdate(result.spotId, "reserved");
      broadcastLotSnapshot();
      return res.status(201).json(result);
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

// Sprint 3 T1: exit lookup and settlement APIs.
app.get(
  "/api/exit/lookup/:ticketId",
  authenticateToken,
  requireGate("Exit-"),
  async (req, res) => {
    try {
      const transaction = await lookupByTicket(req.params.ticketId);
      return res.status(200).json(transaction);
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

app.get("/api/exit/search", authenticateToken, requireGate("Exit-"), async (req, res) => {
  try {
    const transactions = await searchByPlate(req.query.plateNumber);
    return res.status(200).json(transactions);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

app.post(
  "/api/exit/process",
  authenticateToken,
  requireGate("Exit-"),
  async (req, res) => {
    try {
      const receipt = await processExit({
        ticketId: req.body?.ticketId,
        plateNumber: req.body?.plateNumber,
        gateId: req.user.gateId,
        operatorId: req.user.userId,
      });
      broadcastSpotUpdate(receipt.spotId, "free");
      broadcastLotSnapshot();
      return res.status(200).json(receipt);
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

// Sprint 3 T2: admin analytics, transaction and audit-log reads.
const requireAdmin = requireRole("admin");

app.get(
  "/api/admin/analytics/occupancy",
  authenticateToken,
  requireAdmin,
  async (_req, res) => {
    try {
      return res.status(200).json(await getOccupancy());
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

app.get(
  "/api/admin/analytics/revenue",
  authenticateToken,
  requireAdmin,
  async (_req, res) => {
    try {
      return res.status(200).json(await getRevenue());
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

app.get("/api/admin/transactions", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { plate, from, to, gate } = req.query;
    return res.status(200).json(await listTransactions({ plate, from, to, gate }));
  } catch (error) {
    return sendServiceError(res, error);
  }
});

app.get("/api/admin/audit-log", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { action, actor, from, to } = req.query;
    return res.status(200).json(await listAuditEntries({ action, actor, from, to }));
  } catch (error) {
    return sendServiceError(res, error);
  }
});

// Sprint 3 T2: gate operators report overstays only for their own gate.
app.post(
  "/api/overstay/notify",
  authenticateToken,
  requireRole("operator"),
  async (req, res) => {
    const { vehicleId, gateId } = req.body || {};
    if (gateId !== req.user.gateId) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "This operator is not authorized for this gate",
        },
      });
    }

    try {
      const notification = await notifyOverstay({
        vehicleId,
        gateId,
        operator: req.user,
      });
      io.to("admin").emit("overstay:alert", {
        vehicleId: notification.vehicleId,
        ticketId: notification.ticketId,
        plateNumber: notification.plateNumber,
        gateId: notification.gateId,
        duration: notification.durationSeconds,
      });
      return res.status(200).json(notification);
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

// Sprint 3 T2: admin configuration writes and overstay force-release.
app.put(
  "/api/admin/config/fare-tiers",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { vehicleType, tiers } = req.body || {};
      return res
        .status(200)
        .json(await updateFareTiers({ vehicleType, tiers }, req.user));
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

app.put("/api/admin/config/spots", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { zone, count } = req.body || {};
    const result = await updateSpotCount({ zone, count }, req.user);
    broadcastLotSnapshot();
    return res.status(200).json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

app.post(
  "/api/admin/vehicles/:id/force-release",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await forceRelease({ vehicleId: req.params.id, admin: req.user });
      broadcastSpotUpdate(result.spotId, "free");
      broadcastLotSnapshot();
      return res.status(200).json(result);
    } catch (error) {
      return sendServiceError(res, error);
    }
  },
);

io.on("connection", (socket) => {
  socket.on("identify", async (payload = {}, acknowledge = () => {}) => {
    try {
      const user = verifyToken(payload.token);
      if (!user || !["operator", "admin"].includes(user.role)) {
        throw new Error("The token does not identify an authorized user");
      }
      if (user.role === "operator" && !user.gateId) {
        throw new Error("Operator tokens must include a gate assignment");
      }

      socket.data.user = user;
      socket.join("authenticated");
      socket.join(socketRoomFor(user));
      await sendLotSnapshot(socket);
      acknowledge({ ok: true, role: user.role, gateId: user.gateId });
    } catch (_error) {
      const error = { code: "UNAUTHORIZED", message: "Invalid or expired socket token" };
      socket.emit("identify:error", error);
      acknowledge({ ok: false, error });
    }
  });

  socket.on("disconnect", () => {});
});

module.exports = { app, server, io, sendLotSnapshot };
