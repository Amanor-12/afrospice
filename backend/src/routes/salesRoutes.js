const express = require("express");
const router = express.Router();

const {
  getSales,
  getSaleById,
  createSale,
  submitRefundRequest,
  decideRefundRequest,
  updateSaleStatus
} = require("../controllers/salesController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner"), getSales);
router.get("/:id", allowRoles("Owner"), getSaleById);
router.post("/", allowRoles("Owner"), createSale);
router.post("/:id/refund-request", allowRoles("Owner"), submitRefundRequest);
router.post("/:id/refund-request/decision", allowRoles("Owner"), decideRefundRequest);
router.patch("/:id/status", allowRoles("Owner"), updateSaleStatus);

module.exports = router;
