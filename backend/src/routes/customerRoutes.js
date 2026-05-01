const express = require("express");
const router = express.Router();

const {
  getCustomers,
  getCustomerEnrollmentPreview,
  getCustomerById,
  getCustomerCommunications,
  createCustomer,
  sendCustomerWelcomeMessage,
  updateCustomer,
  deleteCustomer,
} = require("../controllers/customerController");

const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/roles");

router.use(authMiddleware);

router.get("/", allowRoles("Owner"), getCustomers);
router.get("/preview/new", allowRoles("Owner"), getCustomerEnrollmentPreview);
router.get("/:id/communications", allowRoles("Owner"), getCustomerCommunications);
router.get("/:id", allowRoles("Owner"), getCustomerById);
router.post("/", allowRoles("Owner"), createCustomer);
router.post("/:id/communications/welcome", allowRoles("Owner"), sendCustomerWelcomeMessage);
router.post("/:id/send-welcome", allowRoles("Owner"), sendCustomerWelcomeMessage);
router.put("/:id", allowRoles("Owner"), updateCustomer);
router.delete("/:id", allowRoles("Owner"), deleteCustomer);

module.exports = router;
