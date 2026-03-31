const express = require("express");
const router = express.Router();

const {
  getProducts,
  getProductById,
  getRecentInventoryMovements,
  getProductMovements,
  createProduct,
  updateProduct,
  deleteProduct,
  restockProduct
} = require("../controllers/productController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", getProducts);
router.get("/movements/recent", getRecentInventoryMovements);
router.get("/:id/movements", getProductMovements);
router.get("/:id", getProductById);
router.post("/", allowRoles("Owner", "Manager", "Inventory Clerk"), createProduct);
router.put("/:id", allowRoles("Owner", "Manager", "Inventory Clerk"), updateProduct);
router.patch("/:id/restock", allowRoles("Owner", "Manager", "Inventory Clerk"), restockProduct);
router.delete("/:id", allowRoles("Owner", "Manager"), deleteProduct);

module.exports = router;
