const models = require("../models");
const { nextSequence, safeDate, toIsoTimestamp } = require("./mongoRepositoryUtils");

const COUNTER_KEYS = {
  emailLog: "email_log_id",
};

function normalizeEmailLog(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    userId: row.userId === null || row.userId === undefined ? null : Number(row.userId),
    recipientEmail: String(row.recipientEmail || "").trim(),
    status: String(row.status || "failed").trim() || "failed",
    errorMessage: String(row.errorMessage || "").trim(),
    type: String(row.type || "daily-summary").trim() || "daily-summary",
    attempt: Number(row.attempt || 1),
    provider: String(row.provider || "smtp").trim() || "smtp",
    messageId: String(row.messageId || "").trim(),
    subject: String(row.subject || "").trim(),
    digestDate: String(row.digestDate || "").trim(),
    trigger: String(row.trigger || "manual").trim() || "manual",
    timestamp: toIsoTimestamp(row.timestamp),
  };
}

async function createEmailLog(entry = {}) {
  const id = await nextSequence(COUNTER_KEYS.emailLog);
  const timestamp = safeDate(entry.timestamp) || new Date();

  await models.EmailLog.create({
    id,
    userId: entry.userId === null || entry.userId === undefined ? null : Number(entry.userId),
    recipientEmail: String(entry.recipientEmail || "").trim().toLowerCase(),
    status: String(entry.status || "failed").trim() || "failed",
    errorMessage: String(entry.errorMessage || "").trim(),
    type: String(entry.type || "daily-summary").trim() || "daily-summary",
    attempt: Number(entry.attempt || 1),
    provider: String(entry.provider || "smtp").trim() || "smtp",
    messageId: String(entry.messageId || "").trim(),
    subject: String(entry.subject || "").trim(),
    digestDate: String(entry.digestDate || "").trim(),
    trigger: String(entry.trigger || "manual").trim() || "manual",
    timestamp,
  });

  const created = await models.EmailLog.findOne({ id }).lean();
  return normalizeEmailLog(created);
}

async function listEmailLogs({ limit = 50, type = "" } = {}) {
  const normalizedLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const normalizedType = String(type || "").trim().toLowerCase();
  const query = normalizedType ? { type: normalizedType } : {};

  const rows = await models.EmailLog.find(query)
    .sort({ timestamp: -1, id: -1 })
    .limit(normalizedLimit)
    .lean();

  return rows.map(normalizeEmailLog);
}

module.exports = {
  createEmailLog,
  listEmailLogs,
};
