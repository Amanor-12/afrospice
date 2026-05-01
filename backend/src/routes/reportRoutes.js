const express = require("express");
const router = express.Router();

const {
  getReportsOverview,
  getDashboardSummary,
  getOrderAnalytics,
  getBusinessPulse,
  getInventoryIntelligence,
  getCustomerAnalytics,
  getSupplierAnalytics,
  getNotifications,
  acknowledgeNotifications,
  getOwnerAssistantBootstrap,
  postOwnerAssistantChat,
  getMachineForecast,
  getAdvancedReports,
  exportReportsCsv,
} = require("../controllers/reportController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/overview", allowRoles("Owner"), getReportsOverview);
router.get("/dashboard", allowRoles("Owner"), getDashboardSummary);
router.get("/orders", allowRoles("Owner"), getOrderAnalytics);
router.get("/business-pulse", allowRoles("Owner"), getBusinessPulse);
router.get("/inventory-intelligence", allowRoles("Owner"), getInventoryIntelligence);
router.get("/customers", allowRoles("Owner"), getCustomerAnalytics);
router.get("/suppliers", allowRoles("Owner"), getSupplierAnalytics);
router.get("/notifications", allowRoles("Owner"), getNotifications);
router.post(
  "/notifications/acknowledge",
  allowRoles("Owner"),
  acknowledgeNotifications
);
router.get("/ml-forecast", allowRoles("Owner"), getMachineForecast);
router.get(
  "/owner-assistant",
  allowRoles("Owner"),
  getOwnerAssistantBootstrap
);
router.post(
  "/owner-assistant",
  allowRoles("Owner"),
  postOwnerAssistantChat
);
router.get("/export", allowRoles("Owner"), exportReportsCsv);
router.get("/", allowRoles("Owner"), getAdvancedReports);

module.exports = router;
