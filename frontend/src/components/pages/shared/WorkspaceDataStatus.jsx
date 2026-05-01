import { formatDate } from "./dataHelpers";
import { formatRelativeTimeLabel } from "../pageRuntime";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function WorkspaceDataStatus({
  className = "",
  loading = false,
  badge = "",
  tone = "neutral",
  live = false,
  timestamp = "",
  nowTick = null,
  useRelativeTime = false,
  message = "",
  loadingMessage = "Refreshing backend data...",
  waitingMessage = "Waiting for backend data",
  liveIndicatorLabel = "Backend data",
  showPausedBadge = false,
  pausedLabel = "Paused",
  freshThresholdMs = 120000,
}) {
  const timestampMs = timestamp ? new Date(timestamp).getTime() : NaN;
  const hasReferenceNow = typeof nowTick === "number" && Number.isFinite(nowTick);
  const referenceNow = hasReferenceNow ? nowTick : timestampMs;
  const isFreshTimestamp =
    Number.isFinite(timestampMs) &&
    (!hasReferenceNow || Math.max(0, referenceNow - timestampMs) <= freshThresholdMs);
  const canShowLiveIndicator = !loading && live && (!timestamp || isFreshTimestamp);
  const resolvedBadge = loading ? "Loading" : String(badge || "").trim();
  const shouldShowPausedBadge = !loading && !resolvedBadge && !live && showPausedBadge;
  const shouldShowSyncedBadge = canShowLiveIndicator && !resolvedBadge;
  const helperMessage =
    String(message || "").trim() ||
    (loading
      ? loadingMessage
      : timestamp
        ? `Updated ${useRelativeTime ? formatRelativeTimeLabel(timestamp, nowTick) : formatDate(timestamp)}`
        : waitingMessage);

  return (
    <div className={joinClassNames("live-indicator-row", "workspace-data-status", className)}>
      {resolvedBadge ? (
        <span className={`status-pill small ${tone}`}>{resolvedBadge}</span>
      ) : shouldShowPausedBadge ? (
        <span className="status-pill small neutral">{pausedLabel}</span>
      ) : shouldShowSyncedBadge ? (
        <span className="status-pill small success workspace-data-status-sync">Backend synced</span>
      ) : null}
      <small title={canShowLiveIndicator ? liveIndicatorLabel : undefined}>{helperMessage}</small>
    </div>
  );
}

export default WorkspaceDataStatus;
