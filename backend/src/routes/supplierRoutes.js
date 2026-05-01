const express = require("express");
const router = express.Router();

const {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} = require("../controllers/supplierController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner"), getSuppliers);
router.get("/:id", allowRoles("Owner"), getSupplierById);
router.post("/", allowRoles("Owner"), createSupplier);
router.put("/:id", allowRoles("Owner"), updateSupplier);
router.delete("/:id", allowRoles("Owner"), deleteSupplier);

module.exports = router;
