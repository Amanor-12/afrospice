const AppError = require("../errors/AppError");
const logger = require("../utils/logger");
const observabilityService = require("../services/observabilityService");
const { mergeResponseMeta } = require("../utils/response");

function notFoundHandler(req, res) {
  const meta = mergeResponseMeta(res);

  return res.status(404).json({
    success: false,
    message: "Route not found.",
    path: req.originalUrl,
    ...(meta ? { meta } : {}),
  });
}

function errorHandler(err, req, res, next) {
  const normalizedError =
    err instanceof AppError
      ? err
      : new AppError(Number(err?.statusCode) || 500, err?.message || "Server error.", {
          code: err?.code || "UNEXPECTED_ERROR",
          details: err?.details ?? null,
          expose: Number(err?.statusCode) < 500,
        });

  const statusCode = Number(normalizedError.statusCode) || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const requestContext = res.locals?.requestContext || null;
  const logPayload = {
    requestId: requestContext?.requestId || null,
    method: req.method,
    path: req.originalUrl,
    actorUserId: requestContext?.actorUserId ?? null,
    actorStaffId: requestContext?.actorStaffId || "",
    actorRole: requestContext?.actorRole || "",
    statusCode,
    code: normalizedError.code,
    message: normalizedError.message,
    details: normalizedError.details,
  };

  if (isClientError) {
    logger.warn("http.request.rejected", logPayload);
  } else {
    logger.error("http.request.failed", {
      ...logPayload,
      name: normalizedError.name,
      stack: err?.stack || normalizedError.stack,
    });
    void observabilityService.forwardObservabilityEvent("server_incident", {
      ...logPayload,
      name: normalizedError.name,
      stack: err?.stack || normalizedError.stack || null,
      request: {
        sourceIp: requestContext?.sourceIp || null,
        userAgent: requestContext?.userAgent || null,
      },
    });
  }

  const meta = mergeResponseMeta(res);

  return res.status(statusCode).json({
    success: false,
    message:
      normalizedError.expose && normalizedError.message
        ? normalizedError.message
        : "An unexpected server error occurred.",
    ...(normalizedError.details ? { details: normalizedError.details } : {}),
    ...(normalizedError.code ? { code: normalizedError.code } : {}),
    ...(meta ? { meta } : {}),
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
