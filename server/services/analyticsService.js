"use strict";

const Spot = require("../models/Spot");
const Transaction = require("../models/Transaction");

const ZONES = ["2W", "4W"];
const HOUR_MS = 60 * 60 * 1000;

function percentage(part, whole) {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

/**
 * Current lot occupancy per zone plus an hourly history of parked vehicles
 * (VPS-F-051, VPS-F-053). History percentages are measured against the
 * current capacity, since spot counts are not versioned.
 */
async function getOccupancy({ now = new Date(), historyHours = 24 } = {}) {
  const counts = await Spot.aggregate([
    { $group: { _id: { zone: "$zone", status: "$status" }, count: { $sum: 1 } } },
  ]);

  const byZone = {};
  for (const zone of ZONES) byZone[zone] = { total: 0, occupied: 0, pct: 0 };
  for (const { _id, count } of counts) {
    const zone = byZone[_id.zone];
    if (!zone) continue;
    zone.total += count;
    if (_id.status === "reserved") zone.occupied += count;
  }

  let total = 0;
  let occupied = 0;
  for (const zone of Object.values(byZone)) {
    zone.pct = percentage(zone.occupied, zone.total);
    total += zone.total;
    occupied += zone.occupied;
  }

  const windowStart = new Date(now.getTime() - historyHours * HOUR_MS);
  const overlapping = await Transaction.find(
    {
      entryTimestamp: { $lte: now },
      $or: [{ status: "active" }, { exitTimestamp: { $gte: windowStart } }],
    },
    { entryTimestamp: 1, exitTimestamp: 1 },
  ).lean();

  const history = [];
  for (let hoursAgo = historyHours; hoursAgo >= 0; hoursAgo -= 1) {
    const at = new Date(now.getTime() - hoursAgo * HOUR_MS);
    const parked = overlapping.filter(
      ({ entryTimestamp, exitTimestamp }) =>
        entryTimestamp <= at && (!exitTimestamp || exitTimestamp > at),
    ).length;
    history.push({ timestamp: at, occupied: parked, pct: percentage(parked, total) });
  }

  return { totalPct: percentage(occupied, total), total, occupied, byZone, history };
}

/** Revenue from settled transactions, in total, per exit day and per zone (VPS-F-052). */
async function getRevenue() {
  const [result] = await Transaction.aggregate([
    { $match: { status: "completed" } },
    {
      $facet: {
        total: [{ $group: { _id: null, total: { $sum: "$fare" } } }],
        byDay: [
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$exitTimestamp" } },
              total: { $sum: "$fare" },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byZone: [{ $group: { _id: "$vehicleType", total: { $sum: "$fare" } } }],
      },
    },
  ]);

  const byZone = {};
  for (const zone of ZONES) byZone[zone] = 0;
  for (const { _id, total } of result.byZone) byZone[_id] = total;

  return {
    total: result.total[0]?.total ?? 0,
    byDay: result.byDay.map(({ _id, total, count }) => ({ date: _id, total, count })),
    byZone,
  };
}

module.exports = { getOccupancy, getRevenue };
