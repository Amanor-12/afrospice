const settingsRepository = require("../data/repositories/settingsRepository");
const auditLogService = require("./auditLogService");
const dailySummaryService = require("./dailySummaryService");
const customerCommunicationService = require("./customerCommunicationService");
const { refreshDailySummaryJob } = require("../jobs/dailySummaryJob");
const AppError = require("../errors/AppError");
const { validateSettingsPatch } = require("../validation/settingsValidators");

const MANAGER_MUTABLE_SETTINGS_FIELDS = new Set([
  "managerName",
  "notifications",
  "autoPrintReceipt",
  "showStockWarnings",
  "salesEmailReports",
  "dailySummaryRecipientEmail",
  "dailySummaryDeliveryHour",
  "dailySummaryDeliveryMinute",
  "compactTables",
  "dashboardAnimations",
  "quickCheckout",
  "soundEffects",
  "defaultReportsView",
  "autoLockMinutes",
]);

function isOwnerActor(actor) {
  return String(actor?.role || "").trim() === "Owner";
}

async function recordDeniedSettingsAction(actor, action, details = {}) {
  await auditLogService.recordAuditEvent({
    actor,
    action,
    entityType: "settings",
    entityId: "app_settings:1",
    details,
  });
}

async function assertSettingsMutationAllowed(actor, patch) {
  const changedFields = Object.keys(patch);

  if (changedFields.length === 0) {
    throw new AppError(400, "At least one settings field is required.", {
      code: "SETTINGS_PATCH_EMPTY",
    });
  }

  if (isOwnerActor(actor)) {
    return;
  }

  const disallowedFields = changedFields.filter(
    (field) => !MANAGER_MUTABLE_SETTINGS_FIELDS.has(field)
  );

  if (disallowedFields.length === 0) {
    return;
  }

  await recordDeniedSettingsAction(actor, "settings.update.denied", {
    reason: "Manager attempted to change owner-restricted settings.",
    disallowedFields,
    changedFields,
  });

  throw new AppError(
    403,
    "Owner approval is required for restricted settings changes.",
    {
      code: "SETTINGS_OWNER_APPROVAL_REQUIRED",
    }
  );
}

async function getPublicSettings() {
  const settings = await settingsRepository.getAppSettings();

  return {
    storeName: settings.storeName,
    branchCode: settings.branchCode,
    supportEmail: settings.supportEmail,
    supportPhone: settings.supportPhone,
    currency: settings.currency,
    receiptFooter: settings.receiptFooter,
  };
}

async function getSettings() {
  return settingsRepository.getAppSettings();
}

async function updateSettings(payload, actor) {
  const patch = validateSettingsPatch(payload);
  await assertSettingsMutationAllowed(actor, patch);
  const before = await settingsRepository.getAppSettings();
  const candidateSettings = {
    ...before,
    ...patch,
  };

  if (candidateSettings.salesEmailReports) {
    const fallbackRecipient = String(
      candidateSettings.dailySummaryRecipientEmail || candidateSettings.supportEmail || ""
    )
      .trim()
      .toLowerCase();

    if (!fallbackRecipient) {
      throw new AppError(400, "Daily summary recipient email is required when email summaries are enabled.", {
        code: "DAILY_SUMMARY_RECIPIENT_REQUIRED",
      });
    }

    patch.dailySummaryRecipientEmail = fallbackRecipient;
  }

  const updated = await settingsRepository.updateAppSettings(patch);

  if (
    [
      "salesEmailReports",
      "dailySummaryDeliveryHour",
      "dailySummaryDeliveryMinute",
      "timeZone",
    ].some((field) => Object.prototype.hasOwnProperty.call(patch, field))
  ) {
    await refreshDailySummaryJob();
  }

  await auditLogService.recordAuditEvent({
    actor,
    action: "settings.updated",
    entityType: "settings",
    entityId: "app_settings:1",
    details: {
      changedFields: Object.keys(patch),
      before: Object.fromEntries(
        Object.keys(patch).map((key) => [key, before[key]])
      ),
      after: Object.fromEntries(
        Object.keys(patch).map((key) => [key, updated[key]])
      ),
    },
  });

  return updated;
}

async function getDailySummaryPreview() {
  return dailySummaryService.buildDailySummaryPreview();
}

async function getEmailLogs(actor) {
  const allowedRoles = ["Owner", "Manager"];
  if (!allowedRoles.includes(String(actor?.role || "").trim())) {
    await recordDeniedSettingsAction(actor, "settings.email_logs.read.denied", {
      reason: "Only managers and owners can read email delivery logs.",
    });
    throw new AppError(403, "Manager or owner access is required to read email logs.", {
      code: "SETTINGS_EMAIL_LOG_ROLE_REQUIRED",
    });
  }

  return dailySummaryService.getEmailLogs();
}

async function getCustomerCommunicationsOverview(actor) {
  const allowedRoles = ["Owner", "Manager"];
  if (!allowedRoles.includes(String(actor?.role || "").trim())) {
    await recordDeniedSettingsAction(actor, "settings.customer_communications.read.denied", {
      reason: "Only managers and owners can read customer communication controls.",
    });
    throw new AppError(403, "Manager or owner access is required to read customer communication controls.", {
      code: "SETTINGS_CUSTOMER_COMMUNICATIONS_ROLE_REQUIRED",
    });
  }

  return customerCommunicationService.getOwnerCommunicationWorkspace();
}

async function sendDailySummaryNow(actor) {
  const allowedRoles = ["Owner", "Manager"];
  if (!allowedRoles.includes(String(actor?.role || "").trim())) {
    await recordDeniedSettingsAction(actor, "settings.daily_summary.send.denied", {
      reason: "Only managers and owners can trigger manual daily summaries.",
    });
    throw new AppError(403, "Manager or owner access is required to send the daily summary.", {
      code: "SETTINGS_DAILY_SUMMARY_ROLE_REQUIRED",
    });
  }

  return dailySummaryService.sendDailySummaryNow({
    actor,
    trigger: "manual",
  });
}

async function sendTestEmail(actor) {
  const allowedRoles = ["Owner", "Manager"];
  if (!allowedRoles.includes(String(actor?.role || "").trim())) {
    await recordDeniedSettingsAction(actor, "settings.daily_summary.test.denied", {
      reason: "Only managers and owners can trigger daily summary test emails.",
    });
    throw new AppError(403, "Manager or owner access is required to send the test email.", {
      code: "SETTINGS_DAILY_SUMMARY_TEST_ROLE_REQUIRED",
    });
  }

  return dailySummaryService.sendTestEmail({
    actor,
    trigger: "manual",
  });
}

module.exports = {
  getPublicSettings,
  getSettings,
  updateSettings,
  getDailySummaryPreview,
  getEmailLogs,
  getCustomerCommunicationsOverview,
  sendDailySummaryNow,
  sendTestEmail,
};
