const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const {
  getHealth,
  getReadiness,
  getHealthDetails,
  getAiStatus,
  exportBackup,
  captureClientEvent,
} = require("../controllers/systemController");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");
const runtime = require("../config/runtime");

const clientEventRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: runtime.clientErrorReportingRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many client error reports. Please wait before retrying.",
    code: "CLIENT_ERROR_RATE_LIMITED",
  },
});

router.get("/health", getHealth);
router.get("/readiness", getReadiness);
router.post("/client-events", clientEventRateLimiter, captureClientEvent);
router.get("/health/details", authMiddleware, allowRoles("Owner"), getHealthDetails);
router.get("/ai-status", authMiddleware, allowRoles("Owner"), getAiStatus);
router.get("/backup", authMiddleware, allowRoles("Owner"), exportBackup);

module.exports = router;
