const staffOperationsService = require("../services/staffOperationsService");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/response");

const getStaffSnapshot = asyncHandler(async (req, res) => {
  return success(
    res,
    await staffOperationsService.buildSnapshot(req.user),
    "Staff operations snapshot fetched."
  );
});

const advanceOrder = asyncHandler(async (req, res) => {
  return success(
    res,
    await staffOperationsService.advanceOrder(req.params.id, req.body || {}, req.user),
    "Staff order advanced."
  );
});

const flagOrder = asyncHandler(async (req, res) => {
  return success(
    res,
    await staffOperationsService.flagOrder(req.params.id, req.body || {}, req.user),
    "Staff order flagged."
  );
});

const updatePickLine = asyncHandler(async (req, res) => {
  return success(
    res,
    await staffOperationsService.updatePickLine(
      req.params.id,
      req.params.productId,
      req.body || {},
      req.user
    ),
    "Staff order line updated."
  );
});

const adjustProductStock = asyncHandler(async (req, res) => {
  return success(
    res,
    await staffOperationsService.adjustProductStock(req.params.id, req.body || {}, req.user),
    "Product stock adjusted."
  );
});

const receivePurchaseOrder = asyncHandler(async (req, res) => {
  return success(
    res,
    await staffOperationsService.receivePurchaseOrder(req.params.id, req.body || {}, req.user),
    "Purchase order received from staff workspace."
  );
});

const updateTask = asyncHandler(async (req, res) => {
  return success(
    res,
    await staffOperationsService.updateTask(req.params.id, req.body || {}, req.user),
    "Staff task updated."
  );
});

module.exports = {
  adjustProductStock,
  advanceOrder,
  flagOrder,
  getStaffSnapshot,
  receivePurchaseOrder,
  updatePickLine,
  updateTask,
};
