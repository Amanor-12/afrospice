const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "src", ".env"),
});

const runtime = require("./src/config/runtime");
runtime.assertRuntimeConfig();
const { disconnectDB } = require("./src/config/db");
const { stopLocalReplicaSet } = require("./src/config/localReplicaSet");
const { stopDailySummaryJob } = require("./src/jobs/dailySummaryJob");
const observabilityService = require("./src/services/observabilityService");
const monitoringService = require("./src/services/monitoringService");
const logger = require("./src/utils/logger");
const {
  markReady,
  beginShutdown,
  getLifecycleState,
} = require("./src/utils/processLifecycle");

const app = require("./src/app");

const PORT = runtime.port;
let server = null;
let shutdownPromise = null;
const trackedSockets = new Set();

function serializeError(error) {
  if (!error) {
    return {
      message: "Unknown error",
    };
  }

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: error.stack || null,
  };
}

function releaseSocket(socket) {
  if (!socket) {
    return;
  }

  const activeRequests = Math.max(0, Number(socket.__afrospiceActiveRequests || 0) - 1);
  socket.__afrospiceActiveRequests = activeRequests;

  if (getLifecycleState().shuttingDown && activeRequests === 0 && !socket.destroyed) {
    socket.end();
  }
}

function trackSocket(socket) {
  socket.__afrospiceActiveRequests = 0;
  trackedSockets.add(socket);
  socket.on("close", () => {
    trackedSockets.delete(socket);
  });
}

function trackRequest(req, res) {
  const socket = req.socket;
  if (!socket) {
    return;
  }

  socket.__afrospiceActiveRequests = Number(socket.__afrospiceActiveRequests || 0) + 1;

  let finalized = false;
  const finalize = () => {
    if (finalized) {
      return;
    }

    finalized = true;
    releaseSocket(socket);
  };

  res.on("finish", finalize);
  res.on("close", finalize);
}

function closeIdleSockets() {
  for (const socket of trackedSockets) {
    if (!socket.destroyed && Number(socket.__afrospiceActiveRequests || 0) === 0) {
      socket.end();
    }
  }
}

async function startServer() {
  monitoringService.initializeMonitoring();
  await app.initialize();
  server = app.listen(PORT, () => {
    markReady();
    logger.info("server.started", {
      port: PORT,
      environment: runtime.environment,
      requestTimeoutMs: runtime.serverRequestTimeoutMs,
      keepAliveTimeoutMs: runtime.serverKeepAliveTimeoutMs,
      shutdownGracePeriodMs: runtime.serverShutdownGracePeriodMs,
      monitoring: monitoringService.getMonitoringSummary(),
    });
  });
  server.on("connection", trackSocket);
  server.on("request", trackRequest);
  server.requestTimeout = runtime.serverRequestTimeoutMs;
  server.headersTimeout = runtime.serverHeadersTimeoutMs;
  server.keepAliveTimeout = runtime.serverKeepAliveTimeoutMs;
  server.maxRequestsPerSocket = runtime.serverMaxRequestsPerSocket;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    socket.destroy();
  });
}

startServer().catch((error) => {
  logger.error("server.startup.failed", serializeError(error));
  void observabilityService.forwardObservabilityEvent("process_incident", {
    phase: "startup",
    severity: "error",
    ...serializeError(error),
  });
  process.exit(1);
});

async function shutdown(code = 0, reason = "shutdown") {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  beginShutdown(reason);
  shutdownPromise = (async () => {
    let exitCode = code;
    logger.warn("server.shutdown.requested", {
      reason,
      exitCode,
      trackedSockets: trackedSockets.size,
    });

    const forceCloseTimer = setTimeout(() => {
      logger.warn("server.shutdown.force_close", {
        reason,
        trackedSockets: trackedSockets.size,
      });

      if (server && typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }

      for (const socket of trackedSockets) {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
    }, runtime.serverShutdownGracePeriodMs);
    forceCloseTimer.unref?.();

    try {
      stopDailySummaryJob();
      if (server) {
        if (typeof server.closeIdleConnections === "function") {
          server.closeIdleConnections();
        }
        closeIdleSockets();
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }

      clearTimeout(forceCloseTimer);
      await disconnectDB();
      await stopLocalReplicaSet();
      await monitoringService.flush(2000);
      logger.info("server.shutdown.completed", {
        reason,
        exitCode,
      });
    } catch (error) {
      clearTimeout(forceCloseTimer);
      logger.error("server.shutdown.failed", {
        reason,
        ...serializeError(error),
      });
      await monitoringService.flush(2000);
      exitCode = 1;
    }

    process.exit(exitCode);
  })();

  return shutdownPromise;
}

process.on("SIGTERM", () => {
  void shutdown(0, "SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown(0, "SIGINT");
});

process.on("unhandledRejection", (error) => {
  logger.error("process.unhandled_rejection", serializeError(error));
  void observabilityService.forwardObservabilityEvent("process_incident", {
    phase: "unhandledRejection",
    severity: "error",
    ...serializeError(error),
  });
  void shutdown(1, "unhandledRejection");
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", serializeError(error));
  void observabilityService.forwardObservabilityEvent("process_incident", {
    phase: "uncaughtException",
    severity: "error",
    ...serializeError(error),
  });
  void shutdown(1, "uncaughtException");
});
