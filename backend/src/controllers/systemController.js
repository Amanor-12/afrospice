const systemService = require("../services/systemService");
const observabilityService = require("../services/observabilityService");
const asyncHandler = require("../utils/asyncHandler");
const { success, mergeResponseMeta } = require("../utils/response");
const logger = require("../utils/logger");

const getHealth = asyncHandler(async (req, res) => {
  return success(res, systemService.getHealth(), "System health fetched.");
});

const getReadiness = asyncHandler(async (req, res) => {
  const payload = await systemService.getReadinessReport();
  const statusCode = payload?.summary?.status === "not_ready" ? 503 : 200;
  const meta = mergeResponseMeta(res);
  return res.status(statusCode).json({
    success: statusCode < 400,
    message: "System readiness fetched.",
    data: payload,
    ...(meta ? { meta } : {}),
  });
});

const getHealthDetails = asyncHandler(async (req, res) => {
  return success(res, await systemService.getHealthDetails(), "System diagnostics fetched.");
});

const getAiStatus = asyncHandler(async (req, res) => {
  return success(res, systemService.getAiStatus(), "AI status fetched.");
});

const captureClientEvent = asyncHandler(async (req, res) => {
  const payload = observabilityService.normalizeClientReport(
    req.body || {},
    res.locals?.requestContext || null
  );

  const logLevel = payload.level === "warn" ? "warn" : payload.level === "info" ? "info" : "error";
  logger[logLevel]("frontend.incident.reported", payload);
  void observabilityService.forwardObservabilityEvent("frontend_incident", payload);

  return success(
    res,
    {
      accepted: true,
    },
    "Client event accepted.",
    202
  );
});

const exportBackup = asyncHandler(async (req, res) => {
  const snapshot = await systemService.getBackupSnapshot();
  const dateStamp = new Date().toISOString().slice(0, 10);

  res.header("Content-Type", "application/json");
  res.attachment(`afrospice-backup-${dateStamp}.json`);
  return res.send(JSON.stringify(snapshot, null, 2));
});

module.exports = {
  getHealth,
  getReadiness,
  getHealthDetails,
  getAiStatus,
  exportBackup,
  captureClientEvent,
};
