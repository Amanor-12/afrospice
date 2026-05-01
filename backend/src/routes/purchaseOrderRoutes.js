const express = require("express");
const router = express.Router();

const {
  listPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  createBulkDraftPurchaseOrders,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
} = require("../controllers/purchaseOrderController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner"), listPurchaseOrders);
router.get("/:id", allowRoles("Owner"), getPurchaseOrderById);
router.post("/", allowRoles("Owner"), createPurchaseOrder);
router.post("/bulk-draft", allowRoles("Owner"), createBulkDraftPurchaseOrders);
router.patch("/:id/status", allowRoles("Owner"), updatePurchaseOrderStatus);
router.post("/:id/receive", allowRoles("Owner"), receivePurchaseOrder);

module.exports = router;
