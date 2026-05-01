const express = require("express");
const router = express.Router();

const {
  adjustProductStock,
  advanceOrder,
  flagOrder,
  getStaffSnapshot,
  receivePurchaseOrder,
  updatePickLine,
  updateTask,
} = require("../controllers/staffOperationsController");
const staffSurfaceGuard = require("../middleware/staffSurfaceGuard");

router.use(staffSurfaceGuard);

router.get("/snapshot", getStaffSnapshot);
router.patch("/orders/:id/advance", advanceOrder);
router.patch("/orders/:id/flag", flagOrder);
router.patch("/orders/:id/pick-lines/:productId", updatePickLine);
router.patch("/products/:id/stock-adjust", adjustProductStock);
router.post("/purchase-orders/:id/receive-all", receivePurchaseOrder);
router.patch("/tasks/:id", updateTask);

module.exports = router;
