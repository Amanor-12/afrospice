import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowTrendUp as FiTrendingUp,
  FaArrowUpRightFromSquare as FiArrowUpRight,
  FaBoltLightning as FiZap,
  FaBoxArchive as FiPackage,
  FaPaperPlane as FiSend,
  FaUsers as FiUsers,
  FaXmark as FiX,
  FaComments as FiMessageSquare,
} from "react-icons/fa6";
import { useNavigate } from "react-router-dom";

import API from "../api/api";
import { BACKEND_RUNTIME_MISMATCH_CODE } from "../utils/backendRuntime";

function createMessage(role, payload) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    ...payload,
  };
}

function normalizeAction(action = {}) {
  return {
    label: String(action?.label || "").trim(),
    path: String(action?.path || "").trim(),
    focus: String(action?.focus || "").trim(),
    note: String(action?.note || "").trim(),
  };
}

function normalizeEngine(engine = null) {
  if (!engine) return null;

  if (typeof engine === "string") {
    const label = String(engine || "").trim();
    return label
      ? {
          label,
          detail: "",
          liveModel: false,
          mode: "",
        }
      : null;
  }

  if (typeof engine !== "object") {
    return null;
  }

  const label = String(engine?.label || engine?.mode || "").trim();
  const detail = String(engine?.detail || "").trim();

  if (!label && !detail) {
    return null;
  }

  return {
    label: label || "Owner AI Assistant",
    detail,
    liveModel: Boolean(engine?.liveModel),
    mode: String(engine?.mode || "").trim(),
  };
}

function createAssistantPayload(data = {}, fallbackContent = "") {
  const normalizedFollowUps = Array.isArray(data?.followUps)
    ? data.followUps
    : Array.isArray(data?.suggestedQuestions)
    ? data.suggestedQuestions
    : [];

  return {
    headline: data?.headline || "Owner AI Assistant",
    content: data?.greeting || data?.answer || fallbackContent,
    highlights: Array.isArray(data?.highlights) ? data.highlights : [],
    comparisons: Array.isArray(data?.comparisons) ? data.comparisons : [],
    actions: Array.isArray(data?.actions) ? data.actions.map(normalizeAction).filter((item) => item.label && item.path) : [],
    drilldowns: Array.isArray(data?.drilldowns)
      ? data.drilldowns
          .map((item) => ({
            title: String(item?.title || "").trim(),
            summary: String(item?.summary || "").trim(),
            steps: Array.isArray(item?.steps)
              ? item.steps.map(normalizeAction).filter((step) => step.label && step.path)
              : [],
          }))
          .filter((item) => item.title && item.steps.length)
      : [],
    questionBack: data?.questionBack || "",
    sources: Array.isArray(data?.sources) ? data.sources : [],
    followUps: normalizedFollowUps,
    suggestedQuestions: normalizedFollowUps,
    statusTone: data?.statusTone || "success",
    statusLabel: data?.statusLabel || "",
    disclosure: data?.disclosure || "",
    engine: normalizeEngine(data?.engine || null),
  };
}

const STATIC_QUICK_PROMPTS = [
  {
    label: "Revenue pulse",
    note: "What changed in revenue this week?",
    prompt: "What changed in revenue this week?",
    icon: FiTrendingUp,
  },
  {
    label: "Stock risk",
    note: "Which products are at stockout risk?",
    prompt: "Which products are at stockout risk?",
    icon: FiPackage,
  },
  {
    label: "Workforce view",
    note: "What is the biggest staffing issue right now?",
    prompt: "What is the biggest staffing issue right now?",
    icon: FiUsers,
  },
  {
    label: "Next move",
    note: "Which supplier needs attention now?",
    prompt: "Which supplier needs attention now?",
    icon: FiZap,
  },
];

function buildQuickPromptsFromFollowUps(followUps = []) {
  const icons = [FiTrendingUp, FiPackage, FiUsers, FiZap];

  return followUps
    .slice(0, 4)
    .map((prompt, index) => ({
      label: index === 0 ? "Priority brief" : index === 1 ? "Ops follow-up" : index === 2 ? "Demand check" : "Next question",
      note: String(prompt || "").trim(),
      prompt: String(prompt || "").trim(),
      icon: icons[index] || FiZap,
    }))
    .filter((item) => item.prompt);
}

function buildAssistantNavigation(action = {}) {
  const path = String(action?.path || "").trim();
  const focus = String(action?.focus || "").trim();
  const baseState = {
    assistantActionLabel: action?.label || "",
    assistantActionNote: action?.note || "",
    assistantTs: Date.now(),
  };

  if (!path) {
    return { path: "", state: null };
  }

  if (path === "/pos-dashboard") {
    let nextPath = "/pos-dashboard";
    let inventoryFocus = focus;

    if (focus === "inventory-reorder-planner") {
      nextPath = "/pos-dashboard/reorder";
    } else if (focus === "inventory-create-product") {
      nextPath = "/pos-dashboard/catalog-studio";
    } else if (focus === "inventory-operations-rail") {
      nextPath = "/pos-dashboard/operations";
      inventoryFocus = "inventory-operations";
    }

    return {
      path: nextPath,
      state: {
        ...baseState,
        inventoryFocus: inventoryFocus || "inventory-directory",
      },
    };
  }

  if (path === "/orders") {
    return {
      path,
      state: {
        ...baseState,
        ordersFocus: focus || "orders-ledger",
      },
    };
  }

  return {
    path,
    state: {
      ...baseState,
      assistantFocus: focus || "",
    },
  };
}

function toneToModifier(tone = "") {
  const normalized = String(tone || "").toLowerCase();
  if (normalized === "danger") return "danger";
  if (normalized === "warning") return "warning";
  return "success";
}

function OwnerAssistantDock({ sessionUser }) {
  const navigate = useNavigate();
  const threadRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [bootstrapping, setBootstrapping] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [error, setError] = useState("");

  const displayName = useMemo(
    () => sessionUser?.fullName?.split(" ")?.[0] || "there",
    [sessionUser?.fullName]
  );
  const latestAssistantEngine = useMemo(() => {
    const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.engine);
    return assistantMessage?.engine || "";
  }, [messages]);
  const quickPrompts = useMemo(() => {
    const latestPromptSource = [...messages].reverse().find(
      (message) =>
        message.role === "assistant" &&
        ((Array.isArray(message.followUps) && message.followUps.length) ||
          (Array.isArray(message.suggestedQuestions) && message.suggestedQuestions.length))
    );
    const livePrompts = buildQuickPromptsFromFollowUps(
      latestPromptSource?.followUps || latestPromptSource?.suggestedQuestions || []
    );
    return livePrompts.length ? livePrompts : STATIC_QUICK_PROMPTS;
  }, [messages]);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("afrospice:owner-ai:open", handleOpen);
    return () => window.removeEventListener("afrospice:owner-ai:open", handleOpen);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    if (!open || bootstrapped || bootstrapping || bootstrapError) return;

    let cancelled = false;

    const loadBootstrap = async () => {
      try {
        setBootstrapping(true);
        setError("");
        setBootstrapError("");
        let data = null;

        try {
          const response = await API.get("/reports/owner-assistant");
          data = response?.data?.data || {};
        } catch {
          const replyResponse = await API.post("/reports/owner-assistant", {
            question: "What needs my attention right now?",
            history: [],
          });
          data = {
            ...(replyResponse?.data?.data || {}),
            headline: "Recovered live owner brief",
            disclosure: "Assistant bootstrap recovered from the live reply path.",
          };
        }

        if (cancelled) return;

        const bootstrapMessage = createMessage(
          "assistant",
          createAssistantPayload(
            {
              ...data,
              headline: data?.headline || `Hello ${displayName}`,
            },
            "Ask anything about sales, stock, staff, supplier risk, or forecasting."
          )
        );
        setMessages((current) => (current.length ? current : [bootstrapMessage]));
        setBootstrapped(true);
      } catch (requestError) {
        if (cancelled) return;

        const runtimeMismatch = requestError?.code === BACKEND_RUNTIME_MISMATCH_CODE;
        const routeMissing = Number(requestError?.status || requestError?.response?.status || 0) === 404;
        const failureMessage =
          runtimeMismatch
            ? requestError?.message || "The running backend does not support the owner assistant."
            : routeMissing
            ? "Assistant route is not live on the running backend yet."
            : requestError?.message || "Could not start the assistant.";
        setError(failureMessage);
        setBootstrapError(failureMessage);
        const fallbackMessage = createMessage(
          "assistant",
          createAssistantPayload(
            {
              headline: `Hello ${displayName}`,
              answer: runtimeMismatch
                ? failureMessage
                : routeMissing
                ? "The assistant route is not available on the running backend yet. Restart the backend and try again."
                : "I can help with revenue, inventory, staff, supplier pressure, and forecast questions once the live data route responds again.",
              followUps: [
                "What does the demand forecast say for next week?",
                "Which products are at stockout risk?",
              ],
              statusTone: "warning",
              statusLabel: "Needs Attention",
            },
            ""
          )
        );
        setMessages((current) => (current.length ? current : [fallbackMessage]));
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    };

    loadBootstrap();

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, bootstrapError, bootstrapNonce, bootstrapping, displayName, open]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, bootstrapping, replyLoading]);

  const sendQuestion = async (rawQuestion) => {
    const question = String(rawQuestion || input).trim();
    if (!question || replyLoading) return;

    const userMessage = createMessage("user", {
      headline: "You",
      content: question,
    });

    const nextHistory = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: [message.headline, message.content, message.questionBack ? `Assistant asks: ${message.questionBack}` : ""]
        .filter(Boolean)
        .join(" "),
    }));

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setReplyLoading(true);

    try {
      const response = await API.post("/reports/owner-assistant", {
        question,
        history: nextHistory.slice(-8),
      });
      const data = response?.data?.data || null;

      setMessages((current) => [
        ...current,
        createMessage("assistant", createAssistantPayload(data, "No answer was returned.")),
      ]);
    } catch (requestError) {
      const runtimeMismatch = requestError?.code === BACKEND_RUNTIME_MISMATCH_CODE;
      const routeMissing = Number(requestError?.status || requestError?.response?.status || 0) === 404;
      if (runtimeMismatch) {
        const failureMessage =
          requestError?.message || "The running backend does not support the owner assistant.";
        setError(failureMessage);
        setMessages((current) => [
          ...current,
          createMessage(
            "assistant",
            createAssistantPayload(
              {
                headline: "Assistant backend mismatch",
                answer: failureMessage,
                followUps: [
                  "Restart the workspace runtime",
                  "Open the latest AfroSpice backend",
                ],
                statusTone: "warning",
                statusLabel: "Backend mismatch",
                disclosure: "The frontend reached a backend that is not exposing the current AfroSpice assistant runtime.",
              },
              ""
            )
          ),
        ]);
        return;
      }

      try {
        const fallbackResponse = await API.get("/reports/notifications");
        const alerts = Array.isArray(fallbackResponse?.data?.data?.items)
          ? fallbackResponse.data.data.items
          : [];

        const topAlerts = alerts.slice(0, 4);
        setError("Assistant reply path failed. Showing grounded workspace alerts instead.");
        setMessages((current) => [
          ...current,
          createMessage(
            "assistant",
            createAssistantPayload(
              {
                headline: "Grounded workspace fallback",
                answer: topAlerts.length
                  ? "The assistant reply path is unavailable right now, so here are the highest-priority live alerts from the workspace."
                  : "The assistant reply path is unavailable right now and no live alerts were returned.",
                highlights: topAlerts.map((alert) => ({
                  label: alert.category || "Operations",
                  value: alert.title || "Workspace alert",
                  note: alert.detail || "No extra detail was returned.",
                })),
                actions: topAlerts
                  .map((alert) => ({
                    label: alert?.action?.label || "",
                    path: alert?.action?.path || "",
                    note: alert?.action?.note || "",
                  }))
                  .filter((item) => item.label && item.path),
                followUps: [
                  "What needs my attention right now?",
                  "Which alerts are cash-related?",
                  "Which supplier issue is the most urgent?",
                ],
                statusTone: "warning",
                statusLabel: "Fallback mode",
                disclosure: "Assistant reply failed, so the dock switched to live notification fallback.",
              },
              ""
            )
          ),
        ]);
      } catch {
        setError(
          routeMissing
            ? "Assistant route is not live on the running backend yet."
            : requestError?.message || "Assistant reply failed."
        );
        setMessages((current) => [
          ...current,
          createMessage(
            "assistant",
            createAssistantPayload(
              {
                headline: "Assistant unavailable",
                answer: routeMissing
                  ? "The assistant route is not live on the running backend yet. Restart the backend and ask again."
                  : "I could not answer that from the live workspace right now.",
                statusTone: "warning",
                statusLabel: "Needs Attention",
              },
              ""
            )
          ),
        ]);
      }
    } finally {
      setReplyLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendQuestion(input);
  };

  const handleAction = (action) => {
    const { path, state } = buildAssistantNavigation(action);
    if (!path) return;

    navigate(path, {
      state,
    });
    setOpen(false);
  };

  const retryBootstrap = () => {
    if (bootstrapping || replyLoading) return;
    setMessages([]);
    setInput("");
    setError("");
    setBootstrapError("");
    setBootstrapped(false);
    setBootstrapNonce((value) => value + 1);
  };

  const resetConversation = () => {
    if (bootstrapping || replyLoading) return;
    setMessages([]);
    setInput("");
    setError("");
    setBootstrapError("");
    setBootstrapped(false);
    setBootstrapNonce((value) => value + 1);
  };

  return (
    <div className="owner-assistant-widget">
      {open ? (
        <section className="owner-assistant-card" aria-label="Owner AI assistant">
          <header className="owner-assistant-header">
            <div className="owner-assistant-header-copy">
              <span className="owner-assistant-eyebrow">Grounded workspace AI</span>
              <h3>Executive Assistant</h3>
              <p>Live answers and next actions pulled from your sales, stock, suppliers, and staffing data.</p>
              {latestAssistantEngine ? (
                <div className="owner-assistant-status-row">
                  <span
                    className={`owner-assistant-engine-badge owner-assistant-engine-badge--${
                      latestAssistantEngine.liveModel ? "live" : "grounded"
                    }`}
                  >
                    {latestAssistantEngine.liveModel ? "Hybrid AI" : latestAssistantEngine.label}
                  </span>
                  <span className="owner-assistant-status-note">
                    {latestAssistantEngine.detail || "Live workspace context"}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="owner-assistant-header-actions">
              {(bootstrapError || messages.length > 1) ? (
                <button
                  type="button"
                  className="owner-assistant-utility-button"
                  onClick={bootstrapError ? retryBootstrap : resetConversation}
                  disabled={bootstrapping || replyLoading}
                >
                  {bootstrapError ? "Retry" : "Reset"}
                </button>
              ) : null}
              <button
                type="button"
                className="owner-assistant-close-button"
                aria-label="Close assistant"
                onClick={() => setOpen(false)}
              >
                <FiX />
              </button>
            </div>
          </header>

          <div className="owner-assistant-shortcuts">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.prompt}
                type="button"
                className="owner-assistant-shortcut"
                onClick={() => sendQuestion(prompt.prompt)}
                disabled={replyLoading}
              >
                <span className="owner-assistant-shortcut-icon">
                  <prompt.icon />
                </span>
                <span className="owner-assistant-shortcut-copy">
                  <strong>{prompt.label}</strong>
                  <small>{prompt.note}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="owner-assistant-thread" ref={threadRef}>
            {!messages.length && !bootstrapping && !replyLoading ? (
              <div className="owner-assistant-empty">
                <span className="owner-assistant-message-label">Business assistant</span>
                <strong>Ask a live operating question.</strong>
                <p>Use the prompt cards above or ask directly about revenue, inventory, supplier risk, staffing, or forecasting.</p>
              </div>
            ) : null}

            {messages.map((message) => (
              <article
                key={message.id}
                className={`owner-assistant-message owner-assistant-message-${message.role}`}
              >
                <div className="owner-assistant-message-top">
                  <div className="owner-assistant-message-meta">
                    <span className="owner-assistant-message-dot" />
                    <span className="owner-assistant-message-label">
                      {message.headline || (message.role === "user" ? "You" : "Assistant")}
                    </span>
                  </div>
                  {message.role === "assistant" && message.statusLabel ? (
                    <span className={`owner-assistant-message-status owner-assistant-message-status--${toneToModifier(message.statusTone)}`}>
                      {message.statusLabel}
                    </span>
                  ) : null}
                </div>

                <div className="owner-assistant-message-body">
                  <p>{message.content}</p>
                </div>

                {message.highlights?.length ? (
                  <div className="owner-assistant-highlights">
                      {message.highlights.map((item) => (
                      <article
                        key={`${message.id}-${item.label}-${item.value}`}
                        className="owner-assistant-highlight"
                      >
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </article>
                    ))}
                  </div>
                ) : null}

                {message.comparisons?.length ? (
                  <div className="owner-assistant-comparisons">
                    {message.comparisons.map((comparison, index) => (
                      <article
                        key={`${message.id}-${comparison.title || index}`}
                        className="owner-assistant-comparison-card"
                      >
                        <div className="owner-assistant-comparison-head">
                          <strong>{comparison.title || "Comparison"}</strong>
                          {comparison.caption ? <small>{comparison.caption}</small> : null}
                        </div>
                        <div className="owner-assistant-comparison-table-wrap">
                          <table className="owner-assistant-comparison-table">
                            <thead>
                              <tr>
                                {(comparison.columns || []).map((column) => (
                                  <th key={`${message.id}-${comparison.title}-${column}`}>{column}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(comparison.rows || []).map((row, rowIndex) => (
                                <tr key={`${message.id}-${comparison.title}-${rowIndex}`}>
                                  {row.map((cell, cellIndex) => (
                                    <td key={`${message.id}-${comparison.title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {message.actions?.length ? (
                  <div className="owner-assistant-actions">
                    {message.actions.map((action) => (
                      <button
                        key={`${message.id}-${action.path}-${action.label}`}
                        type="button"
                        className="owner-assistant-action"
                        onClick={() => handleAction(action)}
                      >
                        <div className="owner-assistant-action-copy">
                          <strong>{action.label}</strong>
                          <span>{action.note || action.path}</span>
                        </div>
                        <span className="owner-assistant-action-arrow">
                          <FiArrowUpRight />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.drilldowns?.length ? (
                  <div className="owner-assistant-drilldowns">
                    {message.drilldowns.map((drilldown, index) => (
                      <article
                        key={`${message.id}-${drilldown.title || index}`}
                        className="owner-assistant-drilldown-card"
                      >
                        <div className="owner-assistant-drilldown-head">
                          <strong>{drilldown.title}</strong>
                          {drilldown.summary ? <small>{drilldown.summary}</small> : null}
                        </div>
                        <div className="owner-assistant-actions">
                          {drilldown.steps.map((action) => (
                          <button
                              key={`${message.id}-${drilldown.title}-${action.path}-${action.focus}`}
                              type="button"
                              className="owner-assistant-action"
                              onClick={() => handleAction(action)}
                            >
                              <div className="owner-assistant-action-copy">
                                <strong>{action.label}</strong>
                                <span>{action.note || action.path}</span>
                              </div>
                              <span className="owner-assistant-action-arrow">
                                <FiArrowUpRight />
                              </span>
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {message.followUps?.length ? (
                  <div className="owner-assistant-followups">
                    {message.followUps.map((followUp) => (
                      <button
                        key={`${message.id}-${followUp}`}
                        type="button"
                        className="owner-assistant-chip"
                        onClick={() => sendQuestion(followUp)}
                      >
                        {followUp}
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.sources?.length ? (
                  <div className="owner-assistant-sources">
                    {message.sources.map((source) => (
                      <span key={`${message.id}-${source}`} className="owner-assistant-source-pill">
                        {source}
                      </span>
                    ))}
                  </div>
                ) : null}

                {message.questionBack ? (
                  <div className="owner-assistant-questionback">
                    <span>Assistant asks</span>
                    <p>{message.questionBack}</p>
                  </div>
                ) : null}

                {message.disclosure ? <div className="owner-assistant-disclosure">{message.disclosure}</div> : null}
              </article>
            ))}

            {replyLoading || (bootstrapping && !messages.length) ? (
              <article className="owner-assistant-message owner-assistant-message-assistant">
                <div className="owner-assistant-message-top">
                  <div className="owner-assistant-message-meta">
                    <span className="owner-assistant-message-dot" />
                    <span className="owner-assistant-message-label">Assistant</span>
                  </div>
                  <span className="owner-assistant-message-status owner-assistant-message-status--warning">Thinking</span>
                </div>
                <p>Reading the live workspace data and preparing an answer.</p>
              </article>
            ) : null}
          </div>

          <div className="owner-assistant-footer">
            {error ? <div className="owner-assistant-error">{error}</div> : null}

            <form className="owner-assistant-composer" onSubmit={handleSubmit}>
              <textarea
                className="owner-assistant-input"
                rows="3"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit(event);
                  }
                }}
                placeholder="Ask about revenue, inventory, orders, suppliers, staffing, or forecasting."
              />
              <div className="owner-assistant-composer-row">
                <small className="owner-assistant-helper">
                  Grounded in live business data. Use exact IDs, time windows, product names, or supplier names for sharper answers.
                </small>
                <button
                  type="submit"
                  className="owner-assistant-send owner-assistant-send-button"
                  disabled={replyLoading || !input.trim()}
                >
                  <FiSend />
                  {replyLoading ? "Thinking..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : (
        <button
          type="button"
          className="owner-assistant-trigger"
          aria-label="Open business assistant"
          onClick={() => setOpen(true)}
        >
          <span className="owner-assistant-trigger-icon">
            <FiMessageSquare />
          </span>
          <span className="owner-assistant-trigger-copy">
            <strong>Ask AfroSpice AI</strong>
            <small>Live workspace assistant</small>
          </span>
        </button>
      )}
    </div>
  );
}

export default OwnerAssistantDock;
