const cron = require("node-cron");

const settingsRepository = require("../data/repositories/settingsRepository");
const dailySummaryService = require("../services/dailySummaryService");

let scheduledTask = null;
let activeSignature = "";
let jobRunning = false;

function buildSignature(expression, timeZone) {
  return `${expression}|${timeZone}`;
}

function resolveTimeZone(timeZone) {
  const fallback = "America/Toronto";
  const normalized = String(timeZone || fallback).trim() || fallback;

  try {
    Intl.DateTimeFormat("en-CA", {
      timeZone: normalized,
      year: "numeric",
    }).format(new Date());
    return normalized;
  } catch (error) {
    return fallback;
  }
}

function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function shouldCatchUpScheduledSummary(settings = {}) {
  if (!settings.salesEmailReports) {
    return false;
  }

  const timeZone = resolveTimeZone(settings.timeZone);
  const hour = Math.max(0, Math.min(23, Number(settings.dailySummaryDeliveryHour || 7)));
  const minute = Math.max(0, Math.min(59, Number(settings.dailySummaryDeliveryMinute || 0)));
  const nowParts = getTimeZoneParts(new Date(), timeZone);
  const currentMinutes = nowParts.hour * 60 + nowParts.minute;
  const scheduledMinutes = hour * 60 + minute;
  const lastDigestDate = String(settings.dailySummaryLastDigestDate || "").trim();

  if (currentMinutes < scheduledMinutes) {
    return false;
  }

  return lastDigestDate !== nowParts.dateKey;
}

async function runScheduledDailySummary() {
  if (jobRunning) {
    return;
  }

  jobRunning = true;

  try {
    await dailySummaryService.sendDailySummaryNow({
      trigger: "scheduler",
    });
  } catch (error) {
    console.error("Daily summary cron execution failed:", error.message || error);
  } finally {
    jobRunning = false;
  }
}

async function refreshDailySummaryJob() {
  const settings = await settingsRepository.getAppSettings();
  const hour = Math.max(0, Math.min(23, Number(settings.dailySummaryDeliveryHour || 7)));
  const minute = Math.max(0, Math.min(59, Number(settings.dailySummaryDeliveryMinute || 0)));
  const timeZone = resolveTimeZone(settings.timeZone);
  const expression = `${minute} ${hour} * * *`;
  const nextSignature = buildSignature(expression, timeZone);

  if (scheduledTask && activeSignature === nextSignature) {
    if (shouldCatchUpScheduledSummary(settings)) {
      await runScheduledDailySummary();
    }

    return {
      expression,
      timeZone,
    };
  }

  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask.destroy();
    scheduledTask = null;
  }

  scheduledTask = cron.schedule(
    expression,
    () => {
      runScheduledDailySummary().catch((error) => {
        console.error("Daily summary cron tick failed:", error.message || error);
      });
    },
    {
      timezone: timeZone,
      scheduled: true,
    }
  );

  activeSignature = nextSignature;

  if (shouldCatchUpScheduledSummary(settings)) {
    await runScheduledDailySummary();
  }

  return {
    expression,
    timeZone,
  };
}

async function startDailySummaryJob() {
  return refreshDailySummaryJob();
}

function stopDailySummaryJob() {
  if (!scheduledTask) {
    return;
  }

  scheduledTask.stop();
  scheduledTask.destroy();
  scheduledTask = null;
  activeSignature = "";
}

module.exports = {
  startDailySummaryJob,
  refreshDailySummaryJob,
  stopDailySummaryJob,
};
