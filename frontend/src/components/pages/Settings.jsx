import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaBell as FiBell,
  FaCreditCard as FiCreditCard,
  FaGear as FiSettings,
  FaLocationDot as FiMapPin,
  FaTrashCan as FiTrash2,
  FaUser as FiUser,
} from "react-icons/fa6";
import API from "../../api/api";
import {
  isPlatformAuthenticatorAvailable,
  serializePasskeyCredential,
  toPasskeyRegistrationOptions,
} from "../../utils/passkeys";
import WorkspaceBannerStack from "./shared/WorkspaceBannerStack";

const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: FiSettings,
    title: "Store settings",
    description: "Store identity, operating defaults, and core workspace preferences.",
  },
  {
    id: "account",
    label: "Account",
    icon: FiUser,
    title: "Account information",
    description: "Workspace owner details, support contacts, and live floor security controls.",
  },
  {
    id: "localization",
    label: "Localization",
    icon: FiMapPin,
    title: "Localization settings",
    description: "Currency, region, timezone, and the live Ontario tax posture.",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: FiBell,
    title: "Notification settings",
    description: "Operational alerts, notification sound, receipt automation, and reporting digests.",
  },
  {
    id: "billing",
    label: "Billing",
    icon: FiCreditCard,
    title: "Billing information",
    description: "Subscription plan, billing controls, and customer discount policy.",
  },
];

const SETTINGS_SECTION_FIELDS = {
  general: [
    "storeName",
    "domain",
    "branchCode",
    "lowStockThreshold",
    "receiptFooter",
    "defaultReportsView",
    "autoLockMinutes",
    "compactTables",
    "dashboardAnimations",
  ],
  account: [
    "managerName",
    "supportEmail",
    "supportPhone",
    "quickCheckout",
    "requirePinForRefunds",
  ],
  localization: ["currency", "timeZone", "taxRate"],
  notifications: [
    "notifications",
    "soundEffects",
    "autoPrintReceipt",
    "showStockWarnings",
    "salesEmailReports",
    "dailySummaryRecipientEmail",
    "dailySummaryDeliveryHour",
    "dailySummaryDeliveryMinute",
  ],
  billing: [
    "billingPlan",
    "billingProvider",
    "billingContactEmail",
    "billingNextBillingDate",
    "billingAutoCharge",
    "enableDiscounts",
    "customerDiscountMode",
    "defaultCustomerDiscountPct",
    "vipCustomerDiscountPct",
    "maxAutoDiscountPct",
    "aiDiscountSuggestions",
  ],
};

const NUMERIC_FIELDS = new Set([
  "taxRate",
  "lowStockThreshold",
  "autoLockMinutes",
  "defaultCustomerDiscountPct",
  "vipCustomerDiscountPct",
  "maxAutoDiscountPct",
  "dailySummaryDeliveryHour",
  "dailySummaryDeliveryMinute",
]);

const BOOLEAN_FIELDS = new Set([
  "notifications",
  "autoPrintReceipt",
  "enableDiscounts",
  "requirePinForRefunds",
  "showStockWarnings",
  "salesEmailReports",
  "compactTables",
  "dashboardAnimations",
  "quickCheckout",
  "soundEffects",
  "billingAutoCharge",
  "aiDiscountSuggestions",
  "apiAccessEnabled",
]);

const CURRENCY_OPTIONS = ["CAD", "USD"];
const TIME_ZONE_OPTIONS = [
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Vancouver",
  "UTC",
];
const REPORT_VIEW_OPTIONS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"];
const BILLING_PLAN_OPTIONS = ["Starter", "Growth", "Premium", "Enterprise"];
const BILLING_PROVIDER_OPTIONS = ["Manual", "Stripe", "Square", "Paystack"];
const DISCOUNT_MODE_OPTIONS = ["manual", "policy", "guided"];
const AUTO_LOCK_OPTIONS = [15, 30, 45, 60, 90];

function SettingsToggle({ label, hint, checked, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-toggle-copy">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className={`settings-toggle-pill${checked ? " is-on" : ""}`}>
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="settings-toggle-knob" />
      </span>
    </label>
  );
}

function SettingsInfoRow({ label, value, accent }) {
  return (
    <div className={`settings-info-row${accent ? ` settings-info-row--${accent}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTimestamp(value) {
  if (!value) return "Not recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatStatusLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Idle";
  return normalized.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatMissingConfig(value) {
  const items = Array.isArray(value) ? value.filter(Boolean) : [];
  return items.length ? items.join(", ") : "None";
}

function getTransportAccent(transport = {}) {
  if (!transport?.configured) return "brand";

  const health = String(transport?.health || "").trim().toLowerCase();
  if (health === "degraded") return "danger";
  if (health === "warning") return "warning";
  if (health === "ready") return "brand";
  return "success";
}

function formatTransportHealthLabel(transport = {}) {
  if (!transport?.configured) return "Not configured";

  const health = String(transport?.health || "").trim().toLowerCase();
  if (health === "healthy") return "Healthy";
  if (health === "warning") return "Needs review";
  if (health === "degraded") return "Delivery issue";
  if (health === "ready") return "Ready";
  return "Configured";
}

function describeTransportChannel(transport = {}, fallbackLabel = "channel") {
  const provider = String(transport?.provider || fallbackLabel).trim();

  if (!transport?.configured) {
    return `${provider.toUpperCase()} welcome delivery is not configured yet.`;
  }

  return transport?.message || `${provider.toUpperCase()} is configured.`;
}

function describeDailySummaryTransport(transport = {}) {
  const provider = String(transport?.provider || "email").trim();

  if (!transport?.configured) {
    return transport?.message || `${provider.toUpperCase()} transport is not configured yet.`;
  }

  return transport?.message || `${provider.toUpperCase()} is configured.`;
}

function getTransportBannerClass(transport = {}) {
  const health = String(transport?.health || "").trim().toLowerCase();
  if (health === "degraded") return "settings-inline-banner settings-inline-banner--danger";
  if (health === "warning" || health === "unavailable") {
    return "settings-inline-banner settings-inline-banner--warning";
  }
  return "settings-inline-banner";
}

function Settings({
  darkMode,
  setDarkMode,
  settings,
  onSaveSettings,
  settingsSaving,
  currentUser,
}) {
  const triggerNotificationSoundTest = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("afrospice:notification-sound:test"));
  }, []);

  const [form, setForm] = useState(settings);
  const [savedForm, setSavedForm] = useState(settings);
  const [activeSection, setActiveSection] = useState("general");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [platformPasskeyAvailable, setPlatformPasskeyAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeys, setPasskeys] = useState([]);
  const [summaryPreview, setSummaryPreview] = useState(null);
  const [emailLogs, setEmailLogs] = useState([]);
  const [communicationsOverview, setCommunicationsOverview] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailAction, setEmailAction] = useState("");

  useEffect(() => {
    setForm(settings);
    setSavedForm(settings);
  }, [settings]);

  const identityName = currentUser?.fullName || form.managerName || "Workspace Manager";
  const identityEmail =
    currentUser?.email || form.supportEmail || form.billingContactEmail || "support@afrospice.com";
  const identityRole = currentUser?.role || "Owner";
  const identityInitials = useMemo(
    () =>
      String(identityName || "AS")
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "AS",
    [identityName]
  );

  const workspaceControlDescription = "Store identity, operating defaults, and core workspace preferences.";
  const ownerControlTitle = "Store Owner";
  const ownerControlInitials = "SO";
  const activeMeta =
    SETTINGS_SECTIONS.find((section) => section.id === activeSection) || SETTINGS_SECTIONS[0];

  const loadPasskeys = useCallback(async () => {
    if (!currentUser?.id) {
      setPasskeys([]);
      setPlatformPasskeyAvailable(false);
      return;
    }

    setPasskeyLoading(true);

    try {
      const [platformAvailable, passkeyResponse] = await Promise.all([
        isPlatformAuthenticatorAvailable(),
        API.get("/auth/passkeys"),
      ]);

      setPlatformPasskeyAvailable(Boolean(platformAvailable));
      setPasskeys(passkeyResponse?.data?.data?.passkeys || []);
    } catch (loadError) {
      console.error("Failed to load passkeys:", loadError);
      setPasskeys([]);
      setError((current) => current || loadError?.message || "Could not load biometric access.");
    } finally {
      setPasskeyLoading(false);
    }
  }, [currentUser?.id]);

  const loadDailySummaryWorkspace = useCallback(async () => {
    if (!currentUser?.id) {
      setSummaryPreview(null);
      setEmailLogs([]);
      return;
    }

    setEmailLoading(true);

    try {
      const [previewResponse, logResponse, communicationsResponse] = await Promise.all([
        API.get("/settings/daily-summary/preview"),
        API.get("/settings/email-logs"),
        API.get("/settings/customer-communications"),
      ]);

      setSummaryPreview(previewResponse?.data?.data || null);
      setEmailLogs(logResponse?.data?.data || []);
      setCommunicationsOverview(communicationsResponse?.data?.data || null);
    } catch (loadError) {
      console.error("Failed to load daily summary workspace:", loadError);
      setSummaryPreview(null);
      setEmailLogs([]);
      setCommunicationsOverview(null);
      setError((current) => current || loadError?.message || "Could not load daily summary details.");
    } finally {
      setEmailLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) {
      return;
    }

    loadPasskeys();
    loadDailySummaryWorkspace();
  }, [currentUser?.id, loadDailySummaryWorkspace, loadPasskeys]);

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const buildPatchFrom = useCallback((source, fields) =>
    fields.reduce((patch, field) => {
      let value = source?.[field];

      if (NUMERIC_FIELDS.has(field)) {
        value = Number(value || 0);
      } else if (BOOLEAN_FIELDS.has(field)) {
        value = Boolean(value);
      } else if (field === "currency") {
        value = String(value || "").toUpperCase();
      } else {
        value = value ?? "";
      }

      patch[field] = value;
      return patch;
    }, {}), []);

  const buildPatch = (fields) => buildPatchFrom(form, fields);

  const saveFields = async (event, fields, successMessage) => {
    event.preventDefault();
    setNotice("");
    setError("");

    try {
      const nextSettings = await onSaveSettings(buildPatch(fields));
      setForm(nextSettings);
      setSavedForm(nextSettings);
      setNotice(successMessage);
    } catch (saveError) {
      setError(saveError?.message || "Could not save settings.");
    }
  };

  const handleEnablePasskey = async () => {
    if (passkeyBusy) {
      return;
    }

    setNotice("");
    setError("");
    setPasskeyBusy(true);

    try {
      const label = `${form.storeName || "AfroSpice"} owner device`;
      const optionsResponse = await API.post("/auth/passkeys/options", { label });
      const publicKey = toPasskeyRegistrationOptions(optionsResponse?.data?.data?.options || {});
      const credential = await navigator.credentials.create({ publicKey });

      if (!credential) {
        throw new Error("Biometric enrollment was cancelled.");
      }

      const response = await API.post("/auth/passkeys/verify", {
        label,
        response: serializePasskeyCredential(credential),
      });

      setPasskeys(response?.data?.data?.passkeys || []);
      setNotice("Biometric access is enabled for this device.");
    } catch (actionError) {
      console.error("Failed to enable passkey:", actionError);
      setError(actionError?.message || "Could not enable biometric access.");
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleRemovePasskey = async (credentialId) => {
    if (!credentialId || passkeyBusy) {
      return;
    }

    setNotice("");
    setError("");
    setPasskeyBusy(true);

    try {
      const response = await API.delete(`/auth/passkeys/${encodeURIComponent(credentialId)}`);
      setPasskeys(response?.data?.data?.passkeys || []);
      setNotice("Biometric device removed.");
    } catch (actionError) {
      console.error("Failed to remove passkey:", actionError);
      setError(actionError?.message || "Could not remove the biometric device.");
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (emailAction) {
      return;
    }

    setNotice("");
    setError("");
    setEmailAction("test");

    try {
      await API.post("/settings/test-email");
      await loadDailySummaryWorkspace();
      setNotice("Test daily summary email sent.");
    } catch (actionError) {
      console.error("Failed to send test email:", actionError);
      setError(actionError?.message || "Could not send the test email.");
    } finally {
      setEmailAction("");
    }
  };

  const handleSendDailySummaryNow = async () => {
    if (emailAction) {
      return;
    }

    setNotice("");
    setError("");
    setEmailAction("live");

    try {
      await API.post("/settings/daily-summary/send");
      await loadDailySummaryWorkspace();
      setNotice("Daily summary sent.");
    } catch (actionError) {
      console.error("Failed to send daily summary:", actionError);
      setError(actionError?.message || "Could not send the daily summary.");
    } finally {
      setEmailAction("");
    }
  };

  const transportSummary = summaryPreview?.transport || null;
  const scheduleSummary = summaryPreview?.schedule || null;
  const dailySummaryTransportLabel = transportSummary?.provider
    ? `${String(transportSummary.provider).toUpperCase()} (${formatTransportHealthLabel(transportSummary)})`
    : formatTransportHealthLabel(transportSummary);
  const deliverySuccessCount = emailLogs.filter((item) => item.status === "success").length;
  const deliveryFailureCount = emailLogs.filter((item) => item.status === "failed").length;
  const outreachDelivery = communicationsOverview?.delivery || {};
  const outreachCoverage = communicationsOverview?.coverage || {};
  const outreachTransport = communicationsOverview?.transport || {};
  const recentOutreachLogs = Array.isArray(communicationsOverview?.recentLogs)
    ? communicationsOverview.recentLogs
    : [];
  const dirtySectionIds = useMemo(
    () =>
      SETTINGS_SECTIONS.filter(
        (section) =>
          JSON.stringify(buildPatchFrom(form, SETTINGS_SECTION_FIELDS[section.id] || [])) !==
          JSON.stringify(buildPatchFrom(savedForm, SETTINGS_SECTION_FIELDS[section.id] || []))
      ).map((section) => section.id),
    [buildPatchFrom, form, savedForm]
  );

  return (
    <div className={`page-container settings-reference-page settings-reference-page--${activeSection}`}>
      <WorkspaceBannerStack error={error} notice={notice} />

      <section className="reference-page-heading settings-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">
            Settings &nbsp;&rsaquo;&nbsp; {activeMeta.label}
          </span>
          <h1>Settings</h1>
          <p>{activeMeta.description}</p>
        </div>
      </section>

      <div className="settings-control-shell">
        <aside className="settings-control-rail">
          <div className="settings-control-owner-card">
            <div className="settings-control-owner-avatar">{ownerControlInitials}</div>
            <div className="settings-control-owner-copy">
              <span className="reference-page-kicker">Workspace controls</span>
              <strong>{ownerControlTitle}</strong>
              <small>{workspaceControlDescription}</small>
              <div className="settings-control-owner-pills">
                <span className="settings-control-owner-pill">{identityRole}</span>
                <span className="settings-control-owner-pill">{form.branchCode || "AFR-MAIN-001"}</span>
              </div>
            </div>
          </div>

          <div className="settings-control-group-label">Control sections</div>
          <nav className="settings-control-list">
  {SETTINGS_SECTIONS.map((section) => {
    const navItemClassName = [
      "settings-control-item",
      `settings-control-item--${section.id}`,
      section.id === activeSection ? "is-active" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        key={section.id}
        type="button"
        className={navItemClassName}
        onClick={() => setActiveSection(section.id)}
        aria-current={section.id === activeSection ? "page" : undefined}
      >
        <span className={`settings-control-icon settings-control-icon--${section.id}`}>
          <section.icon />
        </span>

        <span className="settings-control-copy">
          <strong>{section.label}</strong>
          <small>{section.title}</small>
          {dirtySectionIds.includes(section.id) ? (
            <span className="settings-control-badge">Pending changes</span>
          ) : null}
        </span>
      </button>
    );
  })}
</nav>
        </aside>

        <div className="settings-control-content">
          {activeSection === "general" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["storeName", "domain", "branchCode", "lowStockThreshold", "receiptFooter"],
                    "Store settings saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Store settings</h3>
                    <p>Store identity, domain handling, and core retail defaults.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <label>
                    <span className="field-label">Store name</span>
                    <input
                      className="input"
                      value={form.storeName || ""}
                      onChange={(event) => updateField("storeName", event.target.value)}
                    />
                  </label>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Domain</span>
                      <input
                        className="input"
                        value={form.domain || ""}
                        onChange={(event) => updateField("domain", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Branch code</span>
                      <input
                        className="input"
                        value={form.branchCode || ""}
                        onChange={(event) => updateField("branchCode", event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Low-stock threshold</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        value={form.lowStockThreshold ?? 10}
                        onChange={(event) => updateField("lowStockThreshold", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Receipt footer</span>
                      <input
                        className="input"
                        value={form.receiptFooter || ""}
                        onChange={(event) => updateField("receiptFooter", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["defaultReportsView", "autoLockMinutes", "compactTables", "dashboardAnimations"],
                    "Workspace preferences saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Preferences</h3>
                    <p>Set how the workspace behaves day to day for operations and reporting.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Default reports view</span>
                      <select
                        className="toolbar-select"
                        value={form.defaultReportsView || "Monthly"}
                        onChange={(event) => updateField("defaultReportsView", event.target.value)}
                      >
                        {REPORT_VIEW_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Auto-lock after inactivity</span>
                      <select
                        className="toolbar-select"
                        value={form.autoLockMinutes ?? 30}
                        onChange={(event) => updateField("autoLockMinutes", event.target.value)}
                      >
                        {AUTO_LOCK_OPTIONS.map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} Minutes
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="settings-toggle-list">
                    <SettingsToggle
                      label="Compact tables"
                      hint="Reduce row density in long operational tables."
                      checked={Boolean(form.compactTables)}
                      onChange={(event) => updateField("compactTables", event.target.checked)}
                    />
                    <SettingsToggle
                      label="Dashboard animations"
                      hint="Keep live charts and transitions active in the workspace."
                      checked={Boolean(form.dashboardAnimations)}
                      onChange={(event) => updateField("dashboardAnimations", event.target.checked)}
                    />
                    <SettingsToggle
                      label="Use dark mode"
                      hint="Apply the darker workspace theme on this device only."
                      checked={Boolean(darkMode)}
                      onChange={(event) => setDarkMode(Boolean(event.target.checked))}
                    />
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <section className="settings-surface-card settings-surface-card--danger">
                <div className="settings-surface-head">
                  <div>
                    <h3>Delete store</h3>
                    <p>This workspace is protected. Store deletion should stay behind managed support.</p>
                  </div>
                </div>

                <div className="settings-danger-strip">
                  <div className="settings-danger-icon">
                    <FiTrash2 />
                  </div>
                  <div className="settings-danger-copy">
                    <strong>Delete Store</strong>
                    <small>This would permanently remove the account and all associated retail data.</small>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "account" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["managerName", "supportEmail", "supportPhone"],
                    "Account details saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Account information</h3>
                    <p>Workspace owner identity and support contacts across the retail system.</p>
                  </div>
                </div>

                <div className="settings-account-block">
                  <div className="settings-account-identity">
                    <div className="settings-account-avatar">{identityInitials}</div>
                    <div className="settings-account-copy">
                      <strong>{identityName}</strong>
                      <span>{identityEmail}</span>
                      <small>{identityRole}</small>
                    </div>
                  </div>

                  <div className="stack-form">
                    <label>
                      <span className="field-label">Manager name</span>
                      <input
                        className="input"
                        value={form.managerName || ""}
                        onChange={(event) => updateField("managerName", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Support email</span>
                      <input
                        className="input"
                        type="email"
                        value={form.supportEmail || ""}
                        onChange={(event) => updateField("supportEmail", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Support phone</span>
                      <input
                        className="input"
                        value={form.supportPhone || ""}
                        onChange={(event) => updateField("supportPhone", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["quickCheckout", "requirePinForRefunds"],
                    "Workspace account controls saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Workspace controls</h3>
                    <p>Security and operator experience settings for the live retail floor.</p>
                  </div>
                </div>

                <div className="settings-toggle-list">
                  <SettingsToggle
                    label="Quick checkout"
                    hint="Keep the faster checkout flow active for cashiers."
                    checked={Boolean(form.quickCheckout)}
                    onChange={(event) => updateField("quickCheckout", event.target.checked)}
                  />
                  <SettingsToggle
                    label="Require PIN for refunds"
                    hint="Keep refund approvals behind secure cashier confirmation."
                    checked={Boolean(form.requirePinForRefunds)}
                    onChange={(event) => updateField("requirePinForRefunds", event.target.checked)}
                  />
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <section className="settings-surface-card">
                <div className="settings-surface-head">
                  <div>
                    <h3>Biometric access</h3>
                    <p>Keep fingerprint or Face ID available for the owner without changing the restored page layout.</p>
                  </div>
                </div>

                <div className="settings-info-grid">
                  <SettingsInfoRow
                    label="Platform authenticator"
                    value={platformPasskeyAvailable ? "Available" : "Unavailable"}
                    accent={platformPasskeyAvailable ? "success" : "danger"}
                  />
                  <SettingsInfoRow
                    label="Registered passkeys"
                    value={String(passkeys.length)}
                    accent={passkeys.length ? "brand" : ""}
                  />
                  <SettingsInfoRow
                    label="Last biometric use"
                    value={formatTimestamp(passkeys[0]?.lastUsedAt)}
                  />
                  <SettingsInfoRow
                    label="Owner"
                    value={identityName}
                  />
                </div>

                <div className="settings-inline-note">
                  Sign in once on the owner device, then enable biometrics here. AfroSpice stores a passkey credential for this device, not the fingerprint itself.
                </div>

                {passkeyLoading ? (
                  <div className="settings-inline-banner">Loading biometric devices...</div>
                ) : passkeys.length ? (
                  <div className="settings-passkey-list">
                    {passkeys.map((item) => (
                      <div key={item.credentialId} className="settings-passkey-item">
                        <div className="settings-passkey-copy">
                          <strong>{item.label || "Platform Authenticator"}</strong>
                          <span>
                            Added {formatTimestamp(item.createdAt)}
                            {item.lastUsedAt ? ` | Last used ${formatTimestamp(item.lastUsedAt)}` : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-danger"
                          disabled={passkeyBusy}
                          onClick={() => handleRemovePasskey(item.credentialId)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settings-inline-banner">No biometric devices are enrolled yet for this owner account.</div>
                )}

                <div className="settings-actions-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!platformPasskeyAvailable || passkeyBusy}
                    onClick={handleEnablePasskey}
                  >
                    {passkeyBusy ? "Enabling..." : "Enable Fingerprint or Face ID"}
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "localization" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["currency", "timeZone", "taxRate"],
                    "Localization settings saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Localization settings</h3>
                    <p>Regional defaults for Kitchener, Ontario, currency, and tax handling.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <label>
                    <span className="field-label">Currency</span>
                    <select
                      className="toolbar-select"
                      value={form.currency || "CAD"}
                      onChange={(event) => updateField("currency", event.target.value)}
                    >
                      {CURRENCY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Time zone</span>
                      <select
                        className="toolbar-select"
                        value={form.timeZone || "America/Toronto"}
                        onChange={(event) => updateField("timeZone", event.target.value)}
                      >
                        {TIME_ZONE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Tax rate for taxable items</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.taxRate ?? 13}
                        onChange={(event) => updateField("taxRate", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <section className="settings-surface-card">
                <div className="settings-surface-head">
                  <div>
                    <h3>Ontario grocery tax posture</h3>
                    <p>The workspace now uses product-level tax classes instead of one flat grocery tax.</p>
                  </div>
                </div>

                <div className="settings-info-grid">
                  <SettingsInfoRow label="Basic groceries" value="0% zero-rated" accent="success" />
                  <SettingsInfoRow label="Taxable prepared/snack items" value="13% HST" accent="brand" />
                  <SettingsInfoRow label="Store region" value="Kitchener, Ontario, Canada" />
                  <SettingsInfoRow label="Tax engine" value="Product-by-product" />
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "notifications" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card settings-surface-card--wide"
                onSubmit={async (event) => {
                  await saveFields(
                    event,
                    [
                      "notifications",
                      "soundEffects",
                      "autoPrintReceipt",
                      "showStockWarnings",
                      "salesEmailReports",
                      "dailySummaryRecipientEmail",
                      "dailySummaryDeliveryHour",
                      "dailySummaryDeliveryMinute",
                    ],
                    "Notification settings saved."
                  );
                  await loadDailySummaryWorkspace();
                }}
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Notification settings</h3>
                    <p>Visibility for orders, inventory alerts, and the daily owner summary email.</p>
                  </div>
                </div>

                <div className="settings-notification-groups">
                  <div className="settings-notification-group">
                    <h4>Workspace alerts</h4>
                    <SettingsToggle
                      label="Workspace notifications"
                      hint="Keep live operational alerts visible in the workspace shell."
                      checked={Boolean(form.notifications)}
                      onChange={(event) => updateField("notifications", event.target.checked)}
                    />
                    <SettingsToggle
                      label="Notification sound"
                      hint="Play an alert tone when a new unread notification arrives."
                      checked={Boolean(form.soundEffects)}
                      onChange={(event) => updateField("soundEffects", event.target.checked)}
                    />
                    <div className="settings-inline-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={triggerNotificationSoundTest}
                      >
                        Play Test Tone
                      </button>
                      <small>Check browser audio before saving notification changes.</small>
                    </div>
                  </div>

                  <div className="settings-notification-group">
                    <h4>Lane and inventory</h4>
                    <SettingsToggle
                      label="Auto-print POS receipts"
                      hint="Open the print dialog automatically after a completed sale."
                      checked={Boolean(form.autoPrintReceipt)}
                      onChange={(event) => updateField("autoPrintReceipt", event.target.checked)}
                    />
                    <SettingsToggle
                      label="Low-stock alerts"
                      hint="Warn the store when watched lines fall below threshold."
                      checked={Boolean(form.showStockWarnings)}
                      onChange={(event) => updateField("showStockWarnings", event.target.checked)}
                    />
                  </div>

                  <div className="settings-notification-group">
                    <h4>Daily summary</h4>
                    <SettingsToggle
                      label="Email daily summaries"
                      hint="Send the owner brief to the saved recipient every morning."
                      checked={Boolean(form.salesEmailReports)}
                      onChange={(event) => updateField("salesEmailReports", event.target.checked)}
                    />
                  </div>
                </div>

                <div className="settings-info-grid">
                  <SettingsInfoRow
                    label="Recipient email"
                    value={summaryPreview?.recipientEmail || form.dailySummaryRecipientEmail || "Not set"}
                  />
                  <SettingsInfoRow
                    label="Delivery window"
                    value={scheduleSummary?.deliveryLabel || "7:00 AM America/Toronto"}
                    accent="brand"
                  />
                  <SettingsInfoRow
                    label="Email transport"
                    value={dailySummaryTransportLabel}
                    accent={getTransportAccent(transportSummary)}
                  />
                  <SettingsInfoRow
                    label="Notification sound"
                    value={form.soundEffects ? "Enabled" : "Muted"}
                    accent={form.soundEffects ? "brand" : ""}
                  />
                  <SettingsInfoRow
                    label="Last send status"
                    value={formatStatusLabel(scheduleSummary?.lastStatus)}
                    accent={scheduleSummary?.lastStatus === "sent" ? "success" : scheduleSummary?.lastStatus === "error" ? "danger" : ""}
                  />
                </div>

                <div className="stack-form">
                  <label>
                    <span className="field-label">Recipient email</span>
                    <input
                      className="input"
                      type="email"
                      value={form.dailySummaryRecipientEmail || ""}
                      onChange={(event) => updateField("dailySummaryRecipientEmail", event.target.value)}
                    />
                  </label>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Delivery hour</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="23"
                        value={form.dailySummaryDeliveryHour ?? 7}
                        onChange={(event) => updateField("dailySummaryDeliveryHour", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Delivery minute</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="59"
                        value={form.dailySummaryDeliveryMinute ?? 0}
                        onChange={(event) => updateField("dailySummaryDeliveryMinute", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                {transportSummary?.message ? (
                  <div className={getTransportBannerClass(transportSummary)}>
                    {describeDailySummaryTransport(transportSummary)}
                  </div>
                ) : null}

                {scheduleSummary?.lastError ? (
                  <div className="settings-inline-banner settings-inline-banner--danger">
                    Last delivery error: {scheduleSummary.lastError}
                  </div>
                ) : null}

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={emailAction === "test"}
                    onClick={handleSendTestEmail}
                  >
                    {emailAction === "test" ? "Sending test..." : "Send Test Email"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={emailAction === "live"}
                    onClick={handleSendDailySummaryNow}
                  >
                    {emailAction === "live" ? "Sending..." : "Send Summary Now"}
                  </button>
                </div>
              </form>

              <section className="settings-surface-card">
                <div className="settings-surface-head">
                  <div>
                    <h3>Email delivery history</h3>
                    <p>Every summary and test send is recorded against the live backend delivery log.</p>
                  </div>
                </div>

                <div className="settings-info-grid">
                  <SettingsInfoRow label="Success" value={String(deliverySuccessCount)} accent="success" />
                  <SettingsInfoRow label="Failed" value={String(deliveryFailureCount)} accent="danger" />
                  <SettingsInfoRow
                    label="Last sent"
                    value={formatTimestamp(scheduleSummary?.lastSentAt)}
                  />
                  <SettingsInfoRow
                    label="Digest date"
                    value={scheduleSummary?.lastDigestDate || "Not sent yet"}
                  />
                </div>

                {emailLoading ? (
                  <div className="settings-inline-banner">Loading email logs...</div>
                ) : emailLogs.length ? (
                  <div className="settings-email-log-table">
                    <div className="settings-email-log-row settings-email-log-row--head">
                      <span>Date</span>
                      <span>Status</span>
                      <span>Type</span>
                      <span>Provider</span>
                      <span>Error</span>
                    </div>
                    {emailLogs.slice(0, 8).map((item) => (
                      <div key={item.id} className="settings-email-log-row">
                        <span>{formatTimestamp(item.timestamp)}</span>
                        <span>
                          <span
                            className={`settings-status-chip settings-status-chip--${
                              item.status === "success" ? "success" : "danger"
                            }`}
                          >
                            {formatStatusLabel(item.status)}
                          </span>
                        </span>
                        <span>{formatStatusLabel(item.type)}</span>
                        <span>{item.provider || "n/a"}</span>
                        <span>{item.errorMessage || "None"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settings-inline-banner">No email attempts have been recorded yet.</div>
                )}
              </section>

              <section className="settings-surface-card">
                <div className="settings-surface-head">
                  <div>
                    <h3>Customer communication control</h3>
                    <p>
                      Owner view of loyalty welcome automation, outreach coverage, and recent customer delivery attempts.
                    </p>
                  </div>
                </div>

                <div className="settings-info-grid">
                  <SettingsInfoRow
                    label="Welcome automation"
                    value={communicationsOverview?.automation?.loyaltyWelcomeAutomation ? "Live" : "Off"}
                    accent={communicationsOverview?.automation?.loyaltyWelcomeAutomation ? "success" : "brand"}
                  />
                  <SettingsInfoRow
                    label="Enrolled customers"
                    value={String(outreachCoverage.enrolledCustomers ?? 0)}
                  />
                  <SettingsInfoRow
                    label="Deliverable reach"
                    value={`${outreachCoverage.deliverableCustomers ?? 0} / ${outreachCoverage.enrolledCustomers ?? 0}`}
                    accent="brand"
                  />
                  <SettingsInfoRow
                    label="Marketing opt-ins"
                    value={String(outreachCoverage.marketingOptInCustomers ?? 0)}
                  />
                  <SettingsInfoRow
                    label="Recent successes"
                    value={String(outreachDelivery.success ?? 0)}
                    accent="success"
                  />
                  <SettingsInfoRow
                    label="Recent failures"
                    value={String(outreachDelivery.failed ?? 0)}
                  />
                </div>

                <div className="settings-notification-groups">
                  <div className="settings-notification-group">
                    <h4>Email channel</h4>
                    <p className="settings-channel-note">
                      {describeTransportChannel(outreachTransport.email, "email")}
                    </p>
                    <div className="settings-info-grid">
                      <SettingsInfoRow
                        label="Provider"
                        value={outreachTransport.email?.provider || "Not configured"}
                        accent={getTransportAccent(outreachTransport.email)}
                      />
                      <SettingsInfoRow
                        label="Status"
                        value={formatTransportHealthLabel(outreachTransport.email)}
                        accent={getTransportAccent(outreachTransport.email)}
                      />
                      <SettingsInfoRow
                        label="Missing config"
                        value={formatMissingConfig(outreachTransport.email?.missing)}
                      />
                    </div>
                  </div>

                  <div className="settings-notification-group">
                    <h4>SMS channel</h4>
                    <p className="settings-channel-note">
                      {describeTransportChannel(outreachTransport.sms, "sms")}
                    </p>
                    <div className="settings-info-grid">
                      <SettingsInfoRow
                        label="Provider"
                        value={outreachTransport.sms?.provider || "Not configured"}
                        accent={getTransportAccent(outreachTransport.sms)}
                      />
                      <SettingsInfoRow
                        label="Status"
                        value={formatTransportHealthLabel(outreachTransport.sms)}
                        accent={getTransportAccent(outreachTransport.sms)}
                      />
                      <SettingsInfoRow
                        label="Missing config"
                        value={formatMissingConfig(outreachTransport.sms?.missing)}
                      />
                    </div>
                  </div>
                </div>

                {communicationsOverview?.automation?.triggerSummary ? (
                  <div className="settings-inline-note">{communicationsOverview.automation.triggerSummary}</div>
                ) : null}

                {emailLoading ? (
                  <div className="settings-inline-banner">Loading customer communication history...</div>
                ) : recentOutreachLogs.length ? (
                  <div className="settings-email-log-table settings-email-log-table--communications">
                    <div className="settings-email-log-row settings-email-log-row--communications settings-email-log-row--head">
                      <span>Date</span>
                      <span>Customer</span>
                      <span>Channel</span>
                      <span>Status</span>
                      <span>Recipient</span>
                      <span>Error</span>
                    </div>
                    {recentOutreachLogs.slice(0, 10).map((item) => (
                      <div key={`${item.id}-${item.channel}`} className="settings-email-log-row settings-email-log-row--communications">
                        <span>{formatTimestamp(item.createdAt)}</span>
                        <span>{item.customerName || "Customer"}</span>
                        <span>{formatStatusLabel(item.channel)}</span>
                        <span>
                          <span
                            className={`settings-status-chip settings-status-chip--${
                              item.status === "success" ? "success" : "danger"
                            }`}
                          >
                            {formatStatusLabel(item.status)}
                          </span>
                        </span>
                        <span>{item.recipient || "n/a"}</span>
                        <span>{item.errorMessage || "None"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settings-inline-banner">
                    No customer welcome or outreach attempts have been recorded yet.
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {activeSection === "billing" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    [
                      "billingPlan",
                      "billingProvider",
                      "billingContactEmail",
                      "billingNextBillingDate",
                      "billingAutoCharge",
                    ],
                    "Billing settings saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Billing settings</h3>
                    <p>Plan controls, billing provider, and automatic renewal preferences.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Billing plan</span>
                      <select
                        className="toolbar-select"
                        value={form.billingPlan || "Premium"}
                        onChange={(event) => updateField("billingPlan", event.target.value)}
                      >
                        {BILLING_PLAN_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Billing provider</span>
                      <select
                        className="toolbar-select"
                        value={form.billingProvider || "Manual"}
                        onChange={(event) => updateField("billingProvider", event.target.value)}
                      >
                        {BILLING_PROVIDER_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Billing contact email</span>
                      <input
                        className="input"
                        type="email"
                        value={form.billingContactEmail || ""}
                        onChange={(event) => updateField("billingContactEmail", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Next billing date</span>
                      <input
                        className="input"
                        type="date"
                        value={form.billingNextBillingDate || ""}
                        onChange={(event) => updateField("billingNextBillingDate", event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="settings-toggle-list">
                    <SettingsToggle
                      label="Automatic renewal"
                      hint="Charge the stored billing provider automatically on the next cycle."
                      checked={Boolean(form.billingAutoCharge)}
                      onChange={(event) => updateField("billingAutoCharge", event.target.checked)}
                    />
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    [
                      "enableDiscounts",
                      "customerDiscountMode",
                      "defaultCustomerDiscountPct",
                      "vipCustomerDiscountPct",
                      "maxAutoDiscountPct",
                      "aiDiscountSuggestions",
                    ],
                    "Customer discount policy saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Customer discount policy</h3>
                    <p>Guide cashier discounts with a real policy instead of ad hoc overrides.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <div className="settings-toggle-list">
                    <SettingsToggle
                      label="Enable discounts"
                      hint="Allow discounts to be applied at checkout and in customer workflows."
                      checked={Boolean(form.enableDiscounts)}
                      onChange={(event) => updateField("enableDiscounts", event.target.checked)}
                    />
                    <SettingsToggle
                      label="AI discount suggestions"
                      hint="Use demand and customer history to suggest safe discount ranges."
                      checked={Boolean(form.aiDiscountSuggestions)}
                      onChange={(event) => updateField("aiDiscountSuggestions", event.target.checked)}
                    />
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Discount mode</span>
                      <select
                        className="toolbar-select"
                        value={form.customerDiscountMode || "guided"}
                        onChange={(event) => updateField("customerDiscountMode", event.target.value)}
                      >
                        {DISCOUNT_MODE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Default customer discount %</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={form.defaultCustomerDiscountPct ?? 0}
                        onChange={(event) =>
                          updateField("defaultCustomerDiscountPct", event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">VIP customer discount %</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={form.vipCustomerDiscountPct ?? 0}
                        onChange={(event) =>
                          updateField("vipCustomerDiscountPct", event.target.value)
                        }
                      />
                    </label>

                    <label>
                      <span className="field-label">Maximum automatic discount %</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={form.maxAutoDiscountPct ?? 0}
                        onChange={(event) => updateField("maxAutoDiscountPct", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Settings;
