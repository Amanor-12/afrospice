import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowLeft as FiArrowLeft,
  FaArrowRotateLeft as FiRefund,
  FaClock as FiClock,
  FaShieldHalved as FiShield,
  FaTriangleExclamation as FiAlert,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import { LIVE_PAGE_POLL_INTERVAL_MS } from "./pageRuntime";
import WorkspaceDataStatus from "./shared/WorkspaceDataStatus";
import { firstNumberFrom, formatDate, formatMoney, getResponseData } from "./shared/dataHelpers";

const emptyRequestDraft = {
  orderId: "",
  reason: "",
  note: "",
  incidentReport: "",
  customerStatement: "",
};

const emptyDecisionDraft = {
  decisionNote: "",
  approvalPin: "",
};

function buildRequestDraftSnapshot(draft = {}) {
  return {
    orderId: String(draft?.orderId || "").trim(),
    reason: String(draft?.reason || "").trim(),
    note: String(draft?.note || "").trim(),
    incidentReport: String(draft?.incidentReport || "").trim(),
    customerStatement: String(draft?.customerStatement || "").trim(),
  };
}

function buildDecisionDraftSnapshot(draft = {}) {
  return {
    decisionNote: String(draft?.decisionNote || "").trim(),
    approvalPin: String(draft?.approvalPin || "").trim(),
  };
}

function normalizeSales(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sales)) return payload.sales;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeRefundRequest(order = {}) {
  return {
    status: String(order?.refundRequest?.status || "None").trim() || "None",
    reason: String(order?.refundRequest?.reason || "").trim(),
    note: String(order?.refundRequest?.note || "").trim(),
    incidentReport: String(order?.refundRequest?.incidentReport || "").trim(),
    customerStatement: String(order?.refundRequest?.customerStatement || "").trim(),
    requestedAt: order?.refundRequest?.requestedAt || "",
    requestedByName: String(order?.refundRequest?.requestedByName || "").trim(),
    reviewedAt: order?.refundRequest?.reviewedAt || "",
    reviewedByName: String(order?.refundRequest?.reviewedByName || "").trim(),
    decisionNote: String(order?.refundRequest?.decisionNote || "").trim(),
    approvalPinVerified: Boolean(order?.refundRequest?.approvalPinVerified),
  };
}

function getOrderStatus(order = {}) {
  return String(order?.status || "").trim().toLowerCase();
}

function isPaidOrder(order = {}) {
  return getOrderStatus(order) === "paid";
}

function isRefundedOrder(order = {}) {
  return getOrderStatus(order) === "refunded";
}

function isPendingRefundRequest(order = {}) {
  return normalizeRefundRequest(order).status === "Pending";
}

function isRejectedRefundRequest(order = {}) {
  return normalizeRefundRequest(order).status === "Rejected";
}

function isValidApprovalPin(value = "") {
  return /^\d{4,6}$/.test(String(value || "").trim());
}

function RefundDesk({ settings, currentUser }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currency = settings?.currency || "CAD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";
  const isOwner = String(currentUser?.role || "") === "Owner";

  const [orders, setOrders] = useState([]);
  const [requestDraft, setRequestDraft] = useState(() => ({
    ...emptyRequestDraft,
    orderId: String(location.state?.prefillOrderId || ""),
  }));
  const [selectedRequestId, setSelectedRequestId] = useState(() => String(location.state?.prefillOrderId || ""));
  const [decisionDraft, setDecisionDraft] = useState(emptyDecisionDraft);
  const [loading, setLoading] = useState(true);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;

    const load = async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true);
        }
        const response = await API.get("/sales");
        if (cancelled) return;

        startTransition(() => {
          const salesPayload = normalizeSales(getResponseData(response));
          setOrders(salesPayload);
          setLastUpdated(String(salesPayload[0]?.updatedAt || salesPayload[0]?.date || new Date().toISOString()));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load refund controls.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
      load({ silent: true });
    }, LIVE_PAGE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshNonce]);

  const refundableOrders = useMemo(
    () => orders.filter((order) => isPaidOrder(order) && !isPendingRefundRequest(order)),
    [orders]
  );
  const pendingRefundOrders = useMemo(
    () => orders.filter((order) => isPaidOrder(order) && isPendingRefundRequest(order)),
    [orders]
  );
  const refundedOrders = useMemo(
    () => orders.filter((order) => isRefundedOrder(order)),
    [orders]
  );
  const rejectedRefundOrders = useMemo(
    () => orders.filter((order) => isRejectedRefundRequest(order)),
    [orders]
  );
  const totalRefundedValue = useMemo(
    () => refundedOrders.reduce((sum, order) => sum + firstNumberFrom(order, ["total", "amount"]), 0),
    [refundedOrders]
  );
  const requestTarget = useMemo(
    () => orders.find((order) => String(order?.id) === String(requestDraft.orderId)) || null,
    [orders, requestDraft.orderId]
  );
  const selectedPendingOrder = useMemo(
    () => pendingRefundOrders.find((order) => String(order?.id) === String(selectedRequestId)) || null,
    [pendingRefundOrders, selectedRequestId]
  );
  const selectedRefundRequest = useMemo(
    () => normalizeRefundRequest(selectedPendingOrder),
    [selectedPendingOrder]
  );
  const requestDraftDirty = useMemo(
    () =>
      JSON.stringify(buildRequestDraftSnapshot(requestDraft)) !==
      JSON.stringify(buildRequestDraftSnapshot(emptyRequestDraft)),
    [requestDraft]
  );
  const requestDraftReady = Boolean(
    requestTarget &&
      isPaidOrder(requestTarget) &&
      String(requestDraft.reason || "").trim().length >= 6 &&
      String(requestDraft.incidentReport || "").trim().length >= 12
  );
  const decisionDraftDirty = useMemo(
    () =>
      JSON.stringify(buildDecisionDraftSnapshot(decisionDraft)) !==
      JSON.stringify(buildDecisionDraftSnapshot(emptyDecisionDraft)),
    [decisionDraft]
  );
  const decisionNoteReady = Boolean(
    selectedPendingOrder &&
      String(decisionDraft.decisionNote || "").trim().length >= 6
  );
  const decisionApprovalReady = Boolean(
    isValidApprovalPin(decisionDraft.approvalPin)
  );
  const decisionDraftReady = Boolean(selectedPendingOrder && decisionNoteReady && decisionApprovalReady);

  useEffect(() => {
    if (!pendingRefundOrders.length) {
      setSelectedRequestId("");
      return;
    }

    const hasSelected = pendingRefundOrders.some((order) => String(order?.id) === String(selectedRequestId));
    if (!hasSelected) {
      setSelectedRequestId(String(pendingRefundOrders[0]?.id || ""));
    }
  }, [pendingRefundOrders, selectedRequestId]);

  const submitRefundRequest = async (event) => {
    event.preventDefault();
    if (!requestTarget || requestSubmitting) return;

    if (!isPaidOrder(requestTarget)) {
      setError("Only paid orders can enter the refund queue.");
      return;
    }

    if (String(requestDraft.reason || "").trim().length < 6) {
      setError("Refund reason must be at least 6 characters.");
      return;
    }

    if (String(requestDraft.incidentReport || "").trim().length < 12) {
      setError("Incident report must be at least 12 characters.");
      return;
    }

    try {
      setRequestSubmitting(true);
      setError("");
      setNotice("");
      await API.post(`/sales/${requestTarget.id}/refund-request`, {
        reason: String(requestDraft.reason || "").trim(),
        note: String(requestDraft.note || "").trim(),
        incidentReport: String(requestDraft.incidentReport || "").trim(),
        customerStatement: String(requestDraft.customerStatement || "").trim(),
      });

      setNotice(`Refund report submitted for order ${requestTarget.id}.`);
      setDecisionDraft(emptyDecisionDraft);
      setSelectedRequestId(String(requestTarget.id));
      setRequestDraft(emptyRequestDraft);
      setRefreshNonce((value) => value + 1);
    } catch (requestError) {
      setError(requestError?.message || "Could not submit the refund request.");
    } finally {
      setRequestSubmitting(false);
    }
  };

  const handleRefundDecision = async (decision) => {
    if (!selectedPendingOrder || decisionSubmitting) return;

    if (String(decisionDraft.decisionNote || "").trim().length < 6) {
      setError("Decision note must be at least 6 characters.");
      return;
    }

    if (decision === "Approved" && !isValidApprovalPin(decisionDraft.approvalPin)) {
      setError("Approval PIN must use 4 to 6 digits.");
      return;
    }

    try {
      setDecisionSubmitting(true);
      setError("");
      setNotice("");
      await API.post(`/sales/${selectedPendingOrder.id}/refund-request/decision`, {
        decision,
        decisionNote: String(decisionDraft.decisionNote || "").trim(),
        approvalPin: decision === "Approved" ? String(decisionDraft.approvalPin || "").trim() : "",
      });

      setNotice(
        decision === "Approved"
          ? `Refund approved for order ${selectedPendingOrder.id}.`
          : `Refund request rejected for order ${selectedPendingOrder.id}.`
      );
      setDecisionDraft(emptyDecisionDraft);
      setRefreshNonce((value) => value + 1);
    } catch (requestError) {
      setError(requestError?.message || "Could not review the refund request.");
    } finally {
      setDecisionSubmitting(false);
    }
  };

  const resetRequestDraft = () => {
    setRequestDraft(emptyRequestDraft);
    setError("");
    setNotice("");
  };

  const resetDecisionDraft = () => {
    setDecisionDraft(emptyDecisionDraft);
    setError("");
    setNotice("");
  };

  return (
    <div className="page-container refund-desk-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="reference-page-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Refund desk</span>
          <h1>Refund requests and owner approval</h1>
          <p>
            Review refund incidents as the store owner, approve reversals with the owner PIN, and keep every
            settlement decision auditable from one controlled desk.
          </p>
        </div>

        <div className="reference-page-heading-actions">
          <WorkspaceDataStatus
            loading={loading}
            live={!loading && Boolean(lastUpdated)}
            liveIndicatorLabel="Live refund queue"
            timestamp={lastUpdated}
            nowTick={nowTick}
            useRelativeTime
            showPausedBadge
          />
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/orders")}>
            <FiArrowLeft />
            Back to Orders
          </button>
        </div>
      </section>

      <section className="soft-summary-grid soft-summary-grid--four">
        <article className="soft-summary-card">
          <div className="soft-summary-icon"><FiRefund /></div>
          <span>Eligible orders</span>
          <strong>{refundableOrders.length}</strong>
          <small>Paid orders that can still enter the owner review queue.</small>
        </article>
        <article className="soft-summary-card">
          <div className="soft-summary-icon"><FiClock /></div>
          <span>Awaiting owner decision</span>
          <strong>{pendingRefundOrders.length}</strong>
          <small>Owner review is still required before any inventory is reversed.</small>
        </article>
        <article className="soft-summary-card">
          <div className="soft-summary-icon"><FiAlert /></div>
          <span>Rejected requests</span>
          <strong>{rejectedRefundOrders.length}</strong>
          <small>Refund requests that were held back after owner review.</small>
        </article>
        <article className="soft-summary-card">
          <div className="soft-summary-icon"><FiShield /></div>
          <span>Refunded orders</span>
          <strong>{refundedOrders.length}</strong>
          <small>{formatMoney(currency, totalRefundedValue)} has already been recovered from the ledger.</small>
        </article>
      </section>

      <section className="soft-main-grid soft-main-grid--orders refund-desk-shell">
        <article className="soft-panel premium-workbench">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Incident report</span>
              <h2>Submit a refund request</h2>
            </div>
            <span className="status-pill small neutral">Request before approval</span>
          </header>

          <form className="stack-form premium-form" onSubmit={submitRefundRequest}>
            <div className={`refund-desk-status-bar${requestDraftDirty ? " is-dirty" : ""}`}>
              <div className="refund-desk-status-copy">
                <span className="reference-page-kicker">Request draft</span>
                <strong>{requestDraftReady ? "Refund report is ready for submission" : "Refund report still needs review details"}</strong>
                <small>
                  {requestTarget
                    ? "Only paid orders can move into the owner queue, and the incident report needs enough detail for a controlled review."
                    : "Select the paid order first, then capture the refund reason and incident narrative for owner review."}
                </small>
              </div>
              <div className="refund-desk-status-actions">
                <span className={`status-pill small ${requestDraftReady ? "success" : requestDraftDirty ? "warning" : "neutral"}`}>
                  {requestDraftReady ? "Ready" : requestDraftDirty ? "In progress" : "Idle"}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetRequestDraft}
                  disabled={!requestDraftDirty}
                >
                  Reset Draft
                </button>
              </div>
            </div>

            <label className="field-shell">
              <span className="field-label">Paid order</span>
              <select
                className="input"
                value={requestDraft.orderId}
                onChange={(event) =>
                  setRequestDraft((current) => ({ ...current, orderId: event.target.value }))
                }
              >
                <option value="">Select a paid order</option>
                {refundableOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    #{order.id} - {order.customer || "Walk-in"} - {formatMoney(currency, firstNumberFrom(order, ["total", "amount"]))}
                  </option>
                ))}
              </select>
            </label>

            <div className="soft-card-grid soft-card-grid--two">
              <div className="premium-inline-stat">
                <span>Selected order</span>
                <strong>{requestTarget ? `#${requestTarget.id}` : "No order selected"}</strong>
                <small>
                  {requestTarget
                    ? `${requestTarget.customer || "Walk-in Customer"} / ${formatDate(requestTarget.date || requestTarget.createdAt)}`
                    : "Choose the paid ticket that needs to enter refund review."}
                </small>
              </div>
              <div className="premium-inline-stat">
                <span>Refund exposure</span>
                <strong>
                  {requestTarget ? formatMoney(currency, firstNumberFrom(requestTarget, ["total", "amount"])) : "--"}
                </strong>
                <small>
                  {requestTarget
                    ? "This amount will only reverse after owner approval."
                    : "Awaiting a paid order selection."}
                </small>
              </div>
            </div>

            <label className="field-shell">
              <span className="field-label">Refund reason</span>
              <input
                className="input"
                type="text"
                value={requestDraft.reason}
                placeholder="Damaged goods, pricing correction, duplicate checkout..."
                onChange={(event) =>
                  setRequestDraft((current) => ({ ...current, reason: event.target.value }))
                }
              />
            </label>

            <label className="field-shell">
              <span className="field-label">Incident report</span>
              <textarea
                className="input textarea"
                rows="4"
                value={requestDraft.incidentReport}
                placeholder="Describe what happened, what was verified, and why the owner should approve or reject this reversal."
                onChange={(event) =>
                  setRequestDraft((current) => ({ ...current, incidentReport: event.target.value }))
                }
              />
            </label>

            <div className="form-two-col">
              <label className="field-shell">
                <span className="field-label">Customer statement</span>
                <textarea
                  className="input textarea"
                  rows="3"
                  value={requestDraft.customerStatement}
                  placeholder="Optional summary of the customer's explanation."
                  onChange={(event) =>
                    setRequestDraft((current) => ({ ...current, customerStatement: event.target.value }))
                  }
                />
              </label>

              <label className="field-shell">
                <span className="field-label">Internal note</span>
                <textarea
                  className="input textarea"
                  rows="3"
                  value={requestDraft.note}
                  placeholder="Optional internal note for audit and owner review."
                  onChange={(event) =>
                    setRequestDraft((current) => ({ ...current, note: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetRequestDraft} disabled={!requestDraftDirty}>
                Reset Draft
              </button>
              <button type="submit" className="btn btn-primary" disabled={!requestDraftReady || requestSubmitting}>
                <FiRefund />
                {requestSubmitting ? "Submitting..." : "Queue For Owner Review"}
              </button>
            </div>
          </form>
        </article>

        <aside className="soft-side-stack">
          <article className="soft-panel">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Approval queue</span>
                <h3>Refund requests waiting for review</h3>
              </div>
              <span className="status-pill small warning">{pendingRefundOrders.length} awaiting owner</span>
            </header>

            <div className="soft-list">
              {loading ? (
                <p className="subtle">Loading refund queue...</p>
              ) : pendingRefundOrders.length ? (
                pendingRefundOrders.map((order) => {
                  const request = normalizeRefundRequest(order);
                  const isActive = String(order?.id) === String(selectedRequestId);

                  return (
                    <button
                      key={order.id}
                      type="button"
                      className={`soft-list-row refund-queue-row${isActive ? " is-active" : ""}`}
                      onClick={() => setSelectedRequestId(String(order.id))}
                    >
                      <div>
                        <strong>#{order.id} / {order.customer || "Walk-in"}</strong>
                        <small>
                          {request.requestedByName || "Owner queue"} / {formatDate(request.requestedAt || order.updatedAt)}
                        </small>
                        <small>{request.reason || "Refund request pending review."}</small>
                      </div>
                      <span className="status-pill small warning">
                        {formatMoney(currency, firstNumberFrom(order, ["total", "amount"]))}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="subtle">No refund requests are waiting for approval right now.</p>
              )}
            </div>
          </article>

          <article className="soft-panel">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Owner decision</span>
                <h3>Approve or reject the selected request</h3>
              </div>
              <span className={`status-pill small ${isOwner ? "success" : "neutral"}`}>
                {isOwner ? "Owner authority" : "Read-only"}
              </span>
            </header>

            {selectedPendingOrder ? (
              <div className="stack-form">
                <div className={`refund-desk-status-bar refund-desk-status-bar--decision${decisionDraftDirty ? " is-dirty" : ""}`}>
                  <div className="refund-desk-status-copy">
                    <span className="reference-page-kicker">Decision draft</span>
                <strong>{decisionDraftReady ? "Owner decision is ready to publish" : "Decision note or approval proof is still required"}</strong>
                <small>
                      Approvals and rejections both require an explicit owner note. Every refund approval also requires the current owner PIN before cash or stock can reverse.
                </small>
                  </div>
                  <div className="refund-desk-status-actions">
                    <span
                      className={`status-pill small ${
                        decisionDraftReady ? "success" : decisionDraftDirty ? "warning" : "neutral"
                      }`}
                    >
                      {decisionDraftReady
                        ? "Ready"
                        : decisionNoteReady && !decisionApprovalReady
                          ? "PIN needed"
                          : decisionDraftDirty
                            ? "In progress"
                            : "Idle"}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={resetDecisionDraft}
                      disabled={!decisionDraftDirty}
                    >
                      Reset Decision
                    </button>
                  </div>
                </div>

                <div className="soft-card-grid soft-card-grid--two">
                  <div className="premium-inline-stat">
                    <span>Order</span>
                    <strong>#{selectedPendingOrder.id}</strong>
                    <small>{selectedPendingOrder.customer || "Walk-in Customer"}</small>
                  </div>
                  <div className="premium-inline-stat">
                    <span>Queued by</span>
                    <strong>{selectedRefundRequest.requestedByName || "Owner queue"}</strong>
                    <small>{formatDate(selectedRefundRequest.requestedAt || selectedPendingOrder.updatedAt)}</small>
                  </div>
                </div>

                <div className="soft-list">
                  <article className="soft-list-row">
                    <div>
                      <strong>Refund reason</strong>
                      <small>{selectedRefundRequest.reason || "No reason recorded."}</small>
                    </div>
                  </article>
                  <article className="soft-list-row">
                    <div>
                      <strong>Incident report</strong>
                      <small>{selectedRefundRequest.incidentReport || "No incident report recorded."}</small>
                    </div>
                  </article>
                  <article className="soft-list-row">
                    <div>
                      <strong>Customer statement</strong>
                      <small>{selectedRefundRequest.customerStatement || "No customer statement was recorded."}</small>
                    </div>
                  </article>
                  <article className="soft-list-row">
                    <div>
                      <strong>Internal note</strong>
                      <small>{selectedRefundRequest.note || "No internal note was attached."}</small>
                    </div>
                  </article>
                </div>

                <label className="field-shell">
                  <span className="field-label">Owner decision note</span>
                  <textarea
                    className="input textarea"
                    rows="3"
                    value={decisionDraft.decisionNote}
                    placeholder="Record why the request is approved or rejected and what happens next."
                    onChange={(event) =>
                      setDecisionDraft((current) => ({ ...current, decisionNote: event.target.value }))
                    }
                    disabled={!isOwner}
                  />
                </label>

                <label className="field-shell">
                  <span className="field-label">Owner approval PIN</span>
                  <input
                    className="input"
                    type="password"
                    inputMode="numeric"
                    maxLength="6"
                    value={decisionDraft.approvalPin}
                    placeholder="4-6 digits"
                    onChange={(event) =>
                      setDecisionDraft((current) => ({
                        ...current,
                        approvalPin: String(event.target.value || "").replace(/\D/g, "").slice(0, 6),
                      }))
                    }
                    disabled={!isOwner}
                  />
                  <small className="field-support">
                    Owner approval stays locked until the current owner PIN is entered here.
                  </small>
                </label>

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={resetDecisionDraft}
                    disabled={decisionSubmitting || !decisionDraftDirty}
                  >
                    Reset Decision
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleRefundDecision("Rejected")}
                    disabled={!isOwner || decisionSubmitting || !decisionNoteReady}
                  >
                    {decisionSubmitting ? "Reviewing..." : "Reject Request"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleRefundDecision("Approved")}
                    disabled={!isOwner || decisionSubmitting || !decisionDraftReady}
                  >
                    <FiShield />
                    {decisionSubmitting ? "Reviewing..." : "Approve Refund With Owner PIN"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="soft-empty-state">
                <p className="subtle">Select a pending refund request from the queue to review it here.</p>
                <small className="field-support">
                  Owner approval stays locked until the current owner PIN is entered here.
                </small>
              </div>
            )}
          </article>

          <article className="soft-panel">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Policy posture</span>
                <h3>What the workflow now enforces</h3>
              </div>
            </header>
            <div className="soft-list">
              <article className="soft-list-row">
                <div>
                  <strong>Owner review packet before reversal</strong>
                  <small>Every refund starts as an owner-controlled packet with reason, narrative, and customer context.</small>
                </div>
              </article>
              <article className="soft-list-row">
                <div>
                  <strong>Owner PIN before refund reversal</strong>
                  <small>Inventory and settlement stay frozen until the owner authorizes the queued refund with the current PIN.</small>
                </div>
              </article>
              <article className="soft-list-row">
                <div>
                  <strong>Decision note is mandatory</strong>
                  <small>Approvals and rejections both require an explicit recorded decision note.</small>
                </div>
              </article>
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

export default RefundDesk;
