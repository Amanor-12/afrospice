const express = require("express");

const {
  getPublicSettings,
  getSettings,
  getDailySummaryPreview,
  getEmailLogs,
  getCustomerCommunicationsOverview,
  updateSettings,
  sendDailySummaryNow,
  sendTestEmail,
} = require("../controllers/settingsController");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

const router = express.Router();

router.get("/public", getPublicSettings);
router.get("/", authMiddleware, allowRoles("Owner"), getSettings);
router.get(
  "/daily-summary/preview",
  authMiddleware,
  allowRoles("Owner"),
  getDailySummaryPreview
);
router.get(
  "/email-logs",
  authMiddleware,
  allowRoles("Owner"),
  getEmailLogs
);
router.get(
  "/customer-communications",
  authMiddleware,
  allowRoles("Owner"),
  getCustomerCommunicationsOverview
);
router.post(
  "/daily-summary/send",
  authMiddleware,
  allowRoles("Owner"),
  sendDailySummaryNow
);
router.post(
  "/test-email",
  authMiddleware,
  allowRoles("Owner"),
  sendTestEmail
);
router.put("/", authMiddleware, allowRoles("Owner"), updateSettings);

module.exports = router;
