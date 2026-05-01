const customerService = require("../services/customerService");
const customerCommunicationService = require("../services/customerCommunicationService");
const asyncHandler = require("../utils/asyncHandler");
const { success, created } = require("../utils/response");

const getCustomers = asyncHandler(async (req, res) => {
  return success(res, await customerService.getCustomers(req.query || {}), "Customers fetched.");
});

const getCustomerEnrollmentPreview = asyncHandler(async (_req, res) => {
  return success(
    res,
    await customerService.getCustomerEnrollmentPreview(),
    "Customer enrollment preview fetched."
  );
});

const getCustomerById = asyncHandler(async (req, res) => {
  return success(res, await customerService.getCustomerById(req.params.id), "Customer fetched.");
});

const getCustomerCommunications = asyncHandler(async (req, res) => {
  return success(
    res,
    await customerCommunicationService.getCustomerCommunicationSummary(req.params.id),
    "Customer communications fetched."
  );
});

const createCustomer = asyncHandler(async (req, res) => {
  return created(
    res,
    await customerService.createCustomer(req.body || {}, req.user),
    "Customer created successfully."
  );
});

const sendCustomerWelcomeMessage = asyncHandler(async (req, res) => {
  return success(
    res,
    await customerService.sendCustomerWelcomeDispatch(req.params.id, req.user),
    "Loyalty welcome dispatch sent."
  );
});

const updateCustomer = asyncHandler(async (req, res) => {
  return success(
    res,
    await customerService.updateCustomer(req.params.id, req.body || {}, req.user),
    "Customer updated successfully."
  );
});

const deleteCustomer = asyncHandler(async (req, res) => {
  return success(
    res,
    await customerService.deleteCustomer(req.params.id, req.user),
    "Customer deleted successfully."
  );
});

module.exports = {
  getCustomers,
  getCustomerEnrollmentPreview,
  getCustomerById,
  getCustomerCommunications,
  createCustomer,
  sendCustomerWelcomeMessage,
  updateCustomer,
  deleteCustomer,
};
