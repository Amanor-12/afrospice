const models = require("../models");
const { safeDate, toIsoTimestamp } = require("./mongoRepositoryUtils");

function normalizeNotificationReceipt(row) {
  if (!row) return null;

  return {
    userId: Number(row.userId || 0),
    notificationId: String(row.notificationId || "").trim(),
    signature: String(row.signature || "").trim(),
    acknowledgedAt: row.acknowledgedAt ? toIsoTimestamp(row.acknowledgedAt) : "",
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  };
}

async function listNotificationReceiptsByUserId(userId, notificationIds = []) {
  const normalizedUserId = Number(userId || 0);
  if (!normalizedUserId) return [];

  const query = { userId: normalizedUserId };
  const normalizedIds = Array.isArray(notificationIds)
    ? notificationIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (normalizedIds.length) {
    query.notificationId = { $in: normalizedIds };
  }

  const rows = await models.NotificationReceipt.find(query).lean();
  return rows.map(normalizeNotificationReceipt).filter(Boolean);
}

async function acknowledgeNotifications(userId, receipts = []) {
  const normalizedUserId = Number(userId || 0);
  const normalizedReceipts = Array.isArray(receipts)
    ? receipts
        .map((item) => ({
          notificationId: String(item?.notificationId || "").trim(),
          signature: String(item?.signature || "").trim(),
          acknowledgedAt: safeDate(item?.acknowledgedAt) || new Date(),
        }))
        .filter((item) => item.notificationId && item.signature)
    : [];

  if (!normalizedUserId || !normalizedReceipts.length) {
    return [];
  }

  await models.NotificationReceipt.bulkWrite(
    normalizedReceipts.map((item) => ({
      updateOne: {
        filter: {
          userId: normalizedUserId,
          notificationId: item.notificationId,
        },
        update: {
          $set: {
            userId: normalizedUserId,
            notificationId: item.notificationId,
            signature: item.signature,
            acknowledgedAt: item.acknowledgedAt,
            updatedAt: item.acknowledgedAt,
          },
          $setOnInsert: {
            createdAt: item.acknowledgedAt,
          },
        },
        upsert: true,
      },
    }))
  );

  return listNotificationReceiptsByUserId(
    normalizedUserId,
    normalizedReceipts.map((item) => item.notificationId)
  );
}

module.exports = {
  listNotificationReceiptsByUserId,
  acknowledgeNotifications,
};
