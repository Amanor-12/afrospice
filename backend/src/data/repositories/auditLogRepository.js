const models = require("../models");

const COUNTER_KEY = "audit_log_id";

function normalizeRequestSnapshot(request = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return {};
  }

  return {
    method: String(request.method || "").trim(),
    path: String(request.path || "").trim(),
    sourceIp: String(request.sourceIp || "").trim(),
    userAgent: String(request.userAgent || "").trim(),
    sessionId: String(request.sessionId || "").trim(),
  };
}

async function nextAuditLogId() {
  const now = new Date();
  const counter = await models.Counter.findOneAndUpdate(
    { key: COUNTER_KEY },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    {
      upsert: true,
      new: true,
    }
  ).lean();

  return Number(counter?.seq || 1);
}

async function insertAuditLog(entry = {}) {
  const id = await nextAuditLogId();
  await models.AuditLog.create({
    id,
    action: String(entry.action || "").trim(),
    entityType: String(entry.entityType || "").trim(),
    entityId: String(entry.entityId || "").trim(),
    actorUserId:
      entry.actorUserId === null || entry.actorUserId === undefined
        ? null
        : Number(entry.actorUserId),
    actorStaffId: String(entry.actorStaffId || "").trim(),
    actorName: String(entry.actorName || "").trim(),
    requestId: String(entry.requestId || "").trim(),
    request: normalizeRequestSnapshot(entry.request),
    details: entry.details && typeof entry.details === "object" ? entry.details : {},
    createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
  });

  return id;
}

module.exports = {
  insertAuditLog,
};
