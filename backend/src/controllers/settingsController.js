const settingsService = require("../services/settingsService");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/response");

const getPublicSettings = asyncHandler(async (req, res) => {
  return success(res, await settingsService.getPublicSettings(), "Public settings fetched.");
});

const getSettings = asyncHandler(async (req, res) => {
  return success(res, await settingsService.getSettings(), "Settings fetched.");
});

const getDailySummaryPreview = asyncHandler(async (req, res) => {
  return success(
    res,
    await settingsService.getDailySummaryPreview(),
    "Daily summary preview fetched."
  );
});

const getEmailLogs = asyncHandler(async (req, res) => {
  return success(
    res,
    await settingsService.getEmailLogs(req.user),
    "Email logs fetched."
  );
});

const getCustomerCommunicationsOverview = asyncHandler(async (req, res) => {
  return success(
    res,
    await settingsService.getCustomerCommunicationsOverview(req.user),
    "Customer communications overview fetched."
  );
});

const updateSettings = asyncHandler(async (req, res) => {
  return success(
    res,
    await settingsService.updateSettings(req.body || {}, req.user),
    "Settings updated."
  );
});

const sendDailySummaryNow = asyncHandler(async (req, res) => {
  return success(
    res,
    await settingsService.sendDailySummaryNow(req.user),
    "Daily summary sent."
  );
});

const sendTestEmail = asyncHandler(async (req, res) => {
  return success(
    res,
    await settingsService.sendTestEmail(req.user),
    "Test email sent."
  );
});

module.exports = {
  getPublicSettings,
  getSettings,
  getDailySummaryPreview,
  getEmailLogs,
  getCustomerCommunicationsOverview,
  updateSettings,
  sendDailySummaryNow,
  sendTestEmail,
};
