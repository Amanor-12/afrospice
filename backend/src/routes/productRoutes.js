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

router.get("/", allowRoles("Owner"), getProducts);
router.get("/movements/recent", allowRoles("Owner"), getRecentInventoryMovements);
router.get("/:id/movements", allowRoles("Owner"), getProductMovements);
router.get("/:id", allowRoles("Owner"), getProductById);
router.post("/", allowRoles("Owner"), createProduct);
router.put("/:id", allowRoles("Owner"), updateProduct);
router.patch("/:id/restock", allowRoles("Owner"), restockProduct);
router.delete("/:id", allowRoles("Owner"), deleteProduct);

module.exports = router;
