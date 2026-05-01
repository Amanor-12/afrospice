const models = require("../models");
const { nextSequence, safeDate, toIsoTimestamp } = require("./mongoRepositoryUtils");

const COUNTER_KEY = "customer_communication_log_id";

function normalizeCustomerCommunication(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    customerId: Number(row.customerId || 0),
    channel: String(row.channel || "").trim(),
    status: String(row.status || "queued").trim(),
    templateKey: String(row.templateKey || "manual").trim(),
    subject: String(row.subject || "").trim(),
    recipient: String(row.recipient || "").trim(),
    provider: String(row.provider || "").trim(),
    providerMessageId: String(row.providerMessageId || "").trim(),
    contentPreview: String(row.contentPreview || "").trim(),
    errorMessage: String(row.errorMessage || "").trim(),
    triggeredByUserId:
      row.triggeredByUserId === null || row.triggeredByUserId === undefined
        ? null
        : Number(row.triggeredByUserId),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: toIsoTimestamp(row.createdAt),
  };
}

async function createCustomerCommunication(entry = {}) {
  const id = await nextSequence(COUNTER_KEY);
  const createdAt = safeDate(entry.createdAt) || new Date();

  await models.CustomerCommunicationLog.create({
    id,
    customerId: Number(entry.customerId || 0),
    channel: String(entry.channel || "email").trim(),
    status: String(entry.status || "queued").trim(),
    templateKey: String(entry.templateKey || "manual").trim(),
    subject: String(entry.subject || "").trim(),
    recipient: String(entry.recipient || "").trim(),
    provider: String(entry.provider || "").trim(),
    providerMessageId: String(entry.providerMessageId || "").trim(),
    contentPreview: String(entry.contentPreview || "").trim(),
    errorMessage: String(entry.errorMessage || "").trim(),
    triggeredByUserId:
      entry.triggeredByUserId === null || entry.triggeredByUserId === undefined
        ? null
        : Number(entry.triggeredByUserId),
    metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
    createdAt,
  });

  const created = await models.CustomerCommunicationLog.findOne({ id }).lean();
  return normalizeCustomerCommunication(created);
}

async function listCustomerCommunications(customerId, { limit = 20 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  const rows = await models.CustomerCommunicationLog.find({
    customerId: Number(customerId || 0),
  })
    .sort({ createdAt: -1, id: -1 })
    .limit(normalizedLimit)
    .lean();

  return rows.map(normalizeCustomerCommunication);
}

async function listRecentCustomerCommunications({ limit = 40 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(200, Number(limit || 40)));
  const rows = await models.CustomerCommunicationLog.find({})
    .sort({ createdAt: -1, id: -1 })
    .limit(normalizedLimit)
    .lean();

  return rows.map(normalizeCustomerCommunication);
}

module.exports = {
  createCustomerCommunication,
  listCustomerCommunications,
  listRecentCustomerCommunications,
};
