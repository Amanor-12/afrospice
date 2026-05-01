const express = require("express");
const router = express.Router();

const {
  listCycleCounts,
  getCycleCountById,
  createQuickCycleCount,
  completeCycleCount,
} = require("../controllers/cycleCountController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner"), listCycleCounts);
router.get("/:id", allowRoles("Owner"), getCycleCountById);
router.post("/quick-draft", allowRoles("Owner"), createQuickCycleCount);
router.post("/:id/complete", allowRoles("Owner"), completeCycleCount);

module.exports = router;
