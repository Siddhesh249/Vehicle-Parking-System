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

async function sendLotSnapshot(socket) {
  const spots = await Spot.find({}, { spotNumber: 1, zone: 1, status: 1 })
    .sort({ zone: 1, spotNumber: 1 })
    .lean();
  const occupied = spots.filter((spot) => spot.status === "reserved").length;

  socket.emit("lot:snapshot", {
    spots: spots.map((spot) => ({
      id: String(spot._id),
      spotNumber: spot.spotNumber,
      zone: spot.zone,
      status: spot.status,
    })),
    occupancy: {
      total: spots.length ? (occupied / spots.length) * 100 : 0,
      occupied,
      totalSpots: spots.length,
    },
  });
}

function broadcastSpotUpdate(spotId, status) {
  io.emit("spot:update", { spotId: String(spotId), status });
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
    return res.status(200).json(await updateSpotCount({ zone, count }, req.user));
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
