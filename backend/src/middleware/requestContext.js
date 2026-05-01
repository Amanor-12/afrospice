const logger = require("../utils/logger");
const {
  createRequestContext,
  runWithRequestContext,
  getRequestDurationMs,
} = require("../utils/requestContextStore");

function logRequestCompletion(req, res, context, state) {
  const durationMs = getRequestDurationMs(context);
  const level =
    res.statusCode >= 500 ? "error" : res.statusCode >= 400 || state === "aborted" ? "warn" : "info";
  const logPayload = {
    requestId: context.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    statusCode: res.statusCode,
    durationMs,
    state,
    sourceIp: context.sourceIp || null,
    actorUserId: context.actorUserId,
    actorStaffId: context.actorStaffId || "",
    actorRole: context.actorRole || "",
    sessionId: context.sessionId || "",
  };

  logger[level]("http.request.completed", logPayload);
}

function requestContextMiddleware(req, res, next) {
  const context = createRequestContext(req);
  let completed = false;

  res.locals.requestContext = context;
  res.setHeader("X-Request-Id", context.requestId);

  const finalize = (state) => {
    if (completed) {
      return;
    }

    completed = true;
    logRequestCompletion(req, res, res.locals.requestContext || context, state);
  };

  res.on("finish", () => finalize("finished"));
  res.on("close", () => {
    if (!res.writableEnded) {
      finalize("aborted");
    }
  });

  return runWithRequestContext(context, next);
}

module.exports = requestContextMiddleware;
