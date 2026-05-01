import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FaArrowLeft as FiArrowLeft,
  FaShieldHalved as FiShield,
  FaTrashCan as FiTrash,
  FaTruckFast as FiTruck,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import { firstArrayFrom, firstNumberFrom, formatDate, formatMoney, getResponseData, toArray } from "./shared/dataHelpers";

const emptySupplierDraft = {
  recordId: null,
  name: "",
  contactName: "",
  email: "",
  phone: "",
  accountCode: "",
  preferredCategory: "",
  paymentTerms: "",
  reviewCadence: "",
  shipmentCadence: "",
  orderingCutoffTime: "",
  minimumOrderValue: "",
  minimumOrderUnits: "",
  logisticsMode: "",
  dispatchRegion: "",
  receivingWindow: "",
  receivingDock: "",
  complianceTier: "",
  escalationContact: "",
  portalReference: "",
  trackingUrl: "",
  leadTimeDays: "",
  serviceLevelTarget: "",
  notes: "",
  isPreferred: false,
  isActive: true,
};

function normalizeLookupKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(value) {
  const date = safeDate(value);
  if (!date) return "Unset";
  return date.toLocaleDateString();
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSupplierPayload(source = emptySupplierDraft) {
  return {
    name: String(source?.name || "").trim(),
    contactName: String(source?.contactName || "").trim(),
    email: String(source?.email || "").trim(),
    phone: String(source?.phone || "").trim(),
    accountCode: String(source?.accountCode || "").trim(),
    preferredCategory: String(source?.preferredCategory || "").trim(),
    paymentTerms: String(source?.paymentTerms || "").trim(),
    reviewCadence: String(source?.reviewCadence || "").trim(),
    shipmentCadence: String(source?.shipmentCadence || "").trim(),
    orderingCutoffTime: String(source?.orderingCutoffTime || "").trim(),
    minimumOrderValue: toOptionalNumber(source?.minimumOrderValue),
    minimumOrderUnits: toOptionalNumber(source?.minimumOrderUnits),
    logisticsMode: String(source?.logisticsMode || "").trim(),
    dispatchRegion: String(source?.dispatchRegion || "").trim(),
    receivingWindow: String(source?.receivingWindow || "").trim(),
    receivingDock: String(source?.receivingDock || "").trim(),
    complianceTier: String(source?.complianceTier || "").trim(),
    escalationContact: String(source?.escalationContact || "").trim(),
    portalReference: String(source?.portalReference || "").trim(),
    trackingUrl: String(source?.trackingUrl || "").trim(),
    leadTimeDays: toOptionalNumber(source?.leadTimeDays),
    serviceLevelTarget: toOptionalNumber(source?.serviceLevelTarget),
    notes: String(source?.notes || "").trim(),
    isPreferred: Boolean(source?.isPreferred),
    isActive: Boolean(source?.isActive ?? true),
  };
}

function buildSupplierDraftSnapshot(source = emptySupplierDraft) {
  return {
    recordId: source?.recordId || null,
    ...buildSupplierPayload(source),
  };
}

function toSupplierDraft(supplier = null) {
  return {
    recordId: supplier?.id || supplier?.recordId || null,
    name: String(supplier?.name || ""),
    contactName: String(supplier?.contactName || ""),
    email: String(supplier?.email || ""),
    phone: String(supplier?.phone || ""),
    accountCode: String(supplier?.accountCode || ""),
    preferredCategory: String(supplier?.preferredCategory || ""),
    paymentTerms: String(supplier?.paymentTerms || ""),
    reviewCadence: String(supplier?.reviewCadence || ""),
    shipmentCadence: String(supplier?.shipmentCadence || ""),
    orderingCutoffTime: String(supplier?.orderingCutoffTime || ""),
    minimumOrderValue:
      supplier?.minimumOrderValue === null || supplier?.minimumOrderValue === undefined
        ? ""
        : String(supplier.minimumOrderValue),
    minimumOrderUnits:
      supplier?.minimumOrderUnits === null || supplier?.minimumOrderUnits === undefined
        ? ""
        : String(supplier.minimumOrderUnits),
    logisticsMode: String(supplier?.logisticsMode || ""),
    dispatchRegion: String(supplier?.dispatchRegion || ""),
    receivingWindow: String(supplier?.receivingWindow || ""),
    receivingDock: String(supplier?.receivingDock || ""),
    complianceTier: String(supplier?.complianceTier || ""),
    escalationContact: String(supplier?.escalationContact || ""),
    portalReference: String(supplier?.portalReference || ""),
    trackingUrl: String(supplier?.trackingUrl || ""),
    leadTimeDays:
      supplier?.leadTimeDays === null || supplier?.leadTimeDays === undefined
        ? ""
        : String(supplier.leadTimeDays),
    serviceLevelTarget:
      supplier?.serviceLevelTarget === null || supplier?.serviceLevelTarget === undefined
        ? ""
        : String(supplier.serviceLevelTarget),
    notes: String(supplier?.notes || ""),
    isPreferred: Boolean(supplier?.isPreferred),
    isActive: Boolean(supplier?.isActive ?? true),
  };
}

function isOpenPurchaseOrder(order = {}) {
  const status = String(order?.status || "").trim().toLowerCase();
  return !["received", "cancelled"].includes(status);
}

function SupplierStudio({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { supplierId } = useParams();
  const isEditing = Boolean(supplierId);
  const currency = settings?.currency || "CAD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  const [draft, setDraft] = useState(emptySupplierDraft);
  const [baselineDraft, setBaselineDraft] = useState(emptySupplierDraft);
  const [analyticsData, setAnalyticsData] = useState({});
  const [products, setProducts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const requests = [
          API.get("/products"),
          API.get("/purchase-orders?limit=80"),
          API.get("/reports/suppliers?range=monthly"),
        ];

        if (isEditing) {
          requests.unshift(API.get(`/suppliers/${supplierId}`));
        }

        const responses = await Promise.all(requests);
        if (cancelled) return;

        startTransition(() => {
          const supplierResponse = isEditing ? responses[0] : null;
          const productsResponse = responses[isEditing ? 1 : 0];
          const purchaseOrdersResponse = responses[isEditing ? 2 : 1];
          const analyticsResponse = responses[isEditing ? 3 : 2];
          const resolvedDraft = isEditing
            ? toSupplierDraft(getResponseData(supplierResponse))
            : { ...emptySupplierDraft };

          setDraft(resolvedDraft);
          setBaselineDraft(resolvedDraft);
          setProducts(toArray(getResponseData(productsResponse)));
          setPurchaseOrders(toArray(getResponseData(purchaseOrdersResponse)));
          setAnalyticsData(getResponseData(analyticsResponse) || {});
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load the supplier studio.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isEditing, supplierId]);

  const analyticsSupplier = useMemo(() => {
    const supplierRows = firstArrayFrom(analyticsData, ["suppliers"]);
    return (
      supplierRows.find(
        (supplier) =>
          normalizeLookupKey(supplier?.supplier || supplier?.name) === normalizeLookupKey(draft.name)
      ) || null
    );
  }, [analyticsData, draft.name]);

  const liveProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          normalizeLookupKey(product?.supplier) === normalizeLookupKey(draft.name)
      ),
    [draft.name, products]
  );

  const liveOrders = useMemo(
    () =>
      purchaseOrders
        .filter(
          (order) =>
            normalizeLookupKey(order?.supplier) === normalizeLookupKey(draft.name)
        )
        .sort((left, right) => {
          const rightDate =
            safeDate(right?.expectedDate || right?.updatedAt || right?.createdAt)?.getTime() || 0;
          const leftDate =
            safeDate(left?.expectedDate || left?.updatedAt || left?.createdAt)?.getTime() || 0;
          return rightDate - leftDate;
        }),
    [draft.name, purchaseOrders]
  );

  const openOrders = useMemo(() => liveOrders.filter(isOpenPurchaseOrder), [liveOrders]);
  const nextEta = useMemo(
    () =>
      openOrders
        .map((order) => safeDate(order?.expectedDate))
        .filter(Boolean)
        .sort((left, right) => left.getTime() - right.getTime())[0] || null,
    [openOrders]
  );
  const openCommitmentValue = useMemo(
    () => openOrders.reduce((sum, order) => sum + Number(order?.totalEstimatedCost || 0), 0),
    [openOrders]
  );
  const governanceChecklist = useMemo(
    () => [
      {
        label: "Identity controlled",
        ready: Boolean(draft.name && (draft.contactName || draft.email || draft.phone)),
        note: "Supplier identity and at least one operating contact are on file.",
      },
      {
        label: "Commercial rules set",
        ready: Boolean(draft.paymentTerms || draft.minimumOrderValue || draft.minimumOrderUnits),
        note: "Payment terms or minimum-buy policy is captured for procurement.",
      },
      {
        label: "Inbound routing set",
        ready: Boolean(draft.receivingWindow || draft.receivingDock || draft.dispatchRegion),
        note: "Receiving window, dock, or route guidance is ready for the team.",
      },
      {
        label: "Escalation route set",
        ready: Boolean(draft.escalationContact || draft.portalReference || draft.trackingUrl),
        note: "There is a clear escalation or shipment trace path when inbound activity slips.",
      },
    ],
    [
      draft.contactName,
      draft.dispatchRegion,
      draft.email,
      draft.escalationContact,
      draft.minimumOrderUnits,
      draft.minimumOrderValue,
      draft.name,
      draft.paymentTerms,
      draft.phone,
      draft.portalReference,
      draft.receivingDock,
      draft.receivingWindow,
      draft.trackingUrl,
    ]
  );
  const governanceReadiness = useMemo(() => {
    const readyCount = governanceChecklist.filter((item) => item.ready).length;
    return governanceChecklist.length ? Math.round((readyCount / governanceChecklist.length) * 100) : 0;
  }, [governanceChecklist]);
  const orderFloorLabel = useMemo(() => {
    const minValue = toOptionalNumber(draft.minimumOrderValue);
    const minUnits = toOptionalNumber(draft.minimumOrderUnits);
    if (minValue && minUnits) {
      return `${formatMoney(currency, minValue)} / ${minUnits} units`;
    }
    if (minValue) {
      return formatMoney(currency, minValue);
    }
    if (minUnits) {
      return `${minUnits} units`;
    }
    return "No floor set";
  }, [currency, draft.minimumOrderUnits, draft.minimumOrderValue]);
  const supplierPayload = useMemo(() => buildSupplierPayload(draft), [draft]);
  const draftDirty = useMemo(
    () =>
      JSON.stringify(buildSupplierDraftSnapshot(draft)) !==
      JSON.stringify(buildSupplierDraftSnapshot(baselineDraft)),
    [baselineDraft, draft]
  );
  const draftReady = Boolean(supplierPayload.name);
  const openGovernanceItems = governanceChecklist.filter((item) => !item.ready).length;
  const draftStatusTone = !draftReady
    ? "warning"
    : draftDirty
      ? governanceReadiness >= 100
        ? "success"
        : "warning"
      : isEditing
        ? "success"
        : "neutral";
  const draftStatusLabel = !draftReady
    ? "Identity needed"
    : draftDirty
      ? governanceReadiness >= 100
        ? "Ready"
        : "Unsaved"
      : isEditing
        ? "Saved"
        : "Draft shell";
  const draftStatusTitle = !draftReady
    ? "Supplier name is required before this lane can be saved."
    : draftDirty
      ? governanceReadiness >= 100
        ? "This supplier draft is ready for the live directory."
        : "Draft changes are staged and still need review."
      : isEditing
        ? "Supplier record matches the live directory."
        : "Start the supplier profile when the lane is ready.";
  const draftStatusNote = !draftReady
    ? "Add the supplier name first. Contact, procurement, and routing controls can follow once the identity is anchored."
    : draftDirty
      ? openGovernanceItems
        ? `${openGovernanceItems} governance block${openGovernanceItems === 1 ? "" : "s"} still need setup before the lane is fully hardened.`
        : "Identity, procurement, routing, and escalation controls are fully captured."
      : isEditing
        ? "Reset is disabled because there are no local edits waiting to be reverted."
        : "Use this workspace to capture the record before you create the supplier.";

  const resetDraft = () => {
    setDraft({ ...baselineDraft });
    setError("");
    setNotice("");
  };

  const summaryCards = [
    {
      label: "Products on lane",
      value: `${liveProducts.length}`,
      note: liveProducts.length
        ? `${liveProducts.filter((product) => Number(product?.stock || 0) <= 10).length} low-stock SKUs on this lane.`
        : "No catalog products are currently tied to this supplier.",
      icon: FiTruck,
    },
    {
      label: "Open commitments",
      value: `${openOrders.length}`,
      note: openOrders.length
        ? `${formatMoney(currency, openCommitmentValue)} still waiting to land.`
        : "No open purchase-order commitments are linked right now.",
      icon: FiShield,
    },
    {
      label: "Service quality",
      value: analyticsSupplier ? `${firstNumberFrom(analyticsSupplier, ["serviceScore"]).toFixed(0)}/100` : "Unscored",
      note: analyticsSupplier
        ? `${firstNumberFrom(analyticsSupplier, ["fillRate"]).toFixed(1)}% tracked fill rate.`
        : "Live service scoring will appear once receipt history is established.",
      icon: FiShield,
    },
    {
      label: "Lane readiness",
      value: `${governanceReadiness}%`,
      note:
        governanceReadiness >= 100
          ? "Identity, procurement, routing, and escalation controls are in place."
          : `${governanceChecklist.filter((item) => !item.ready).length} governance blocks still need setup.`,
      icon: FiShield,
    },
  ];

  const saveSupplier = async (event) => {
    event.preventDefault();
    if (saving) return;
    const payload = supplierPayload;

    if (!payload.name) {
      setError("Supplier name is required before the record can be saved.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const response = isEditing
        ? await API.put(`/suppliers/${supplierId}`, payload)
        : await API.post("/suppliers", payload);
      const savedSupplier = getResponseData(response) || {};

      navigate("/suppliers", {
        state: {
          assistantActionLabel: isEditing ? "Supplier updated" : "Supplier created",
          assistantActionNote: `${savedSupplier?.name || payload.name} is now saved in the live supplier directory.`,
          highlightSupplierId: savedSupplier?.id,
        },
      });
    } catch (requestError) {
      setError(requestError?.message || "Could not save the supplier record.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSupplier = async () => {
    if (!supplierId || saving) return;

    try {
      setSaving(true);
      setError("");
      setNotice("");
      await API.delete(`/suppliers/${supplierId}`);
      navigate("/suppliers", {
        state: {
          assistantActionLabel: "Supplier removed",
          assistantActionNote: `${draft.name || "The supplier"} was removed from the live directory.`,
        },
      });
    } catch (requestError) {
      setError(requestError?.message || "Could not delete the supplier record.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container supplier-studio-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="reference-page-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Supplier studio</span>
          <h1>{isEditing ? "Supplier governance record" : "Create supplier"}</h1>
          <p>
            Keep supplier identity, commercial controls, and procurement expectations in a dedicated
            record workspace instead of mixing record maintenance into the analytics dashboard.
          </p>
        </div>

        <div className="reference-page-heading-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/suppliers")}>
            <FiArrowLeft />
            Back to Suppliers
          </button>
          {draft.name ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                navigate("/purchase-orders/new", {
                  state: {
                    assistantActionLabel: `Draft inbound order for ${draft.name}`,
                    assistantActionNote:
                      "Supplier ordering stays on its own page so procurement drafting remains deliberate.",
                    prefillPurchaseOrderDraft: {
                      supplier: draft.name,
                      expectedDate: nextEta ? nextEta.toISOString().slice(0, 10) : "",
                      note: `Prepared from the supplier studio for ${draft.name}.`,
                      items: [],
                    },
                  },
                })
              }
            >
              Draft Order
            </button>
          ) : null}
        </div>
      </section>

      <section className="soft-summary-grid soft-summary-grid--three">
        {summaryCards.map((card) => (
          <article key={card.label} className="soft-summary-card">
            <div className="soft-summary-icon">{card.icon ? <card.icon /> : null}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="supplier-studio-shell">
        <article className="soft-panel supplier-studio-main">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Record editor</span>
              <h2>{isEditing ? draft.name || "Edit supplier" : "New supplier profile"}</h2>
              <p className="subtle">
                This record controls how the supplier appears across procurement, replenishment,
                and inbound review.
              </p>
            </div>
            {isEditing ? (
              <span className={`status-pill small ${draft.isActive ? "success" : "neutral"}`}>
                {draft.isActive ? "Active lane" : "Inactive lane"}
              </span>
            ) : null}
          </header>

          <div className={`supplier-studio-status-bar${draftDirty ? " is-dirty" : ""}`}>
            <div className="supplier-studio-status-copy">
              <strong>{draftStatusTitle}</strong>
              <small>{draftStatusNote}</small>
            </div>
            <div className="supplier-studio-status-actions">
              <span className={`status-pill small ${draftStatusTone}`}>{draftStatusLabel}</span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetDraft}
                disabled={saving || loading || !draftDirty}
              >
                {isEditing ? "Reset Changes" : "Clear Draft"}
              </button>
            </div>
          </div>

          <form className="stack-form premium-form" onSubmit={saveSupplier}>
            <div className="suppliers-studio-grid">
              <section className="suppliers-studio-section">
                <div className="suppliers-studio-section-copy">
                  <span className="reference-page-kicker">Identity</span>
                  <h3>Supplier identity</h3>
                  <p>Capture the name and contact details that operations and audits will reference.</p>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Supplier name</span>
                    <input
                      className="input"
                      type="text"
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Primary contact</span>
                    <input
                      className="input"
                      type="text"
                      value={draft.contactName}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, contactName: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Email</span>
                    <input
                      className="input"
                      type="email"
                      value={draft.email}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, email: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Phone</span>
                    <input
                      className="input"
                      type="text"
                      value={draft.phone}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, phone: event.target.value }))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="suppliers-studio-section">
                <div className="suppliers-studio-section-copy">
                  <span className="reference-page-kicker">Commercial profile</span>
                  <h3>Account and terms</h3>
                  <p>Set commercial controls clearly so the supplier behaves like a managed lane, not a contact card.</p>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Account code</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="SUP-2041"
                      value={draft.accountCode}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, accountCode: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Category focus</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Protein, pantry, chilled..."
                      value={draft.preferredCategory}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, preferredCategory: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Payment terms</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Net 30"
                      value={draft.paymentTerms}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, paymentTerms: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Review cadence</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Weekly inbound review"
                      value={draft.reviewCadence}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, reviewCadence: event.target.value }))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="suppliers-studio-section">
                <div className="suppliers-studio-section-copy">
                  <span className="reference-page-kicker">Procurement policy</span>
                  <h3>Cutoff, cadence, and order floors</h3>
                  <p>These controls keep buyers aligned with how the lane actually wants orders staged and transmitted.</p>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Shipment cadence</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Daily, twice weekly, monthly consolidated..."
                      value={draft.shipmentCadence}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, shipmentCadence: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Ordering cutoff</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Orders locked by 2:00 PM the prior day"
                      value={draft.orderingCutoffTime}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, orderingCutoffTime: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Minimum order value</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={draft.minimumOrderValue}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, minimumOrderValue: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Minimum order units</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={draft.minimumOrderUnits}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, minimumOrderUnits: event.target.value }))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="suppliers-studio-section">
                <div className="suppliers-studio-section-copy">
                  <span className="reference-page-kicker">Operating target</span>
                  <h3>Expected service standard</h3>
                  <p>Lead time and service targets turn this supplier into a measurable procurement lane.</p>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Lead time (days)</span>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="365"
                      value={draft.leadTimeDays}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, leadTimeDays: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Service target (%)</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={draft.serviceLevelTarget}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, serviceLevelTarget: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="field-shell">
                  <span className="field-label">Owner notes</span>
                  <textarea
                    className="input textarea"
                    rows="4"
                    value={draft.notes}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>
              </section>

              <section className="suppliers-studio-section">
                <div className="suppliers-studio-section-copy">
                  <span className="reference-page-kicker">Logistics control</span>
                  <h3>Inbound and escalation lane</h3>
                  <p>Capture the receiving window, dispatch region, and escalation path the owner actually needs during supplier exceptions.</p>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Logistics mode</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Direct truck, third-party freight..."
                      value={draft.logisticsMode}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, logisticsMode: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Dispatch region</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Greater Toronto Area"
                      value={draft.dispatchRegion}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, dispatchRegion: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Receiving window</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Mon-Fri / 6:00 AM-1:00 PM"
                      value={draft.receivingWindow}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, receivingWindow: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Receiving dock</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Dock 2 / chilled lane / front receiving"
                      value={draft.receivingDock}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, receivingDock: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Compliance tier</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Preferred, audited, temp-sensitive..."
                      value={draft.complianceTier}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, complianceTier: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Escalation contact</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Escalation manager or hotline"
                      value={draft.escalationContact}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, escalationContact: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="form-two-col">
                  <label className="field-shell">
                    <span className="field-label">Portal reference</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Vendor portal account or reference"
                      value={draft.portalReference}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, portalReference: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field-shell">
                    <span className="field-label">Tracking URL</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="https://tracking.example.com/shipment/..."
                      value={draft.trackingUrl}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, trackingUrl: event.target.value }))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="suppliers-studio-section">
                <div className="suppliers-studio-section-copy">
                  <span className="reference-page-kicker">Lane status</span>
                  <h3>Role inside the network</h3>
                  <p>Preferred and active controls determine how strongly this supplier appears in live procurement flows.</p>
                </div>

                <label className="settings-toggle-row">
                  <span className="settings-toggle-copy">
                    <strong>Preferred supplier</strong>
                    <small>Preferred suppliers remain prominent when the owner opens procurement and replenishment flows.</small>
                  </span>
                  <span className={`settings-toggle-pill${draft.isPreferred ? " is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={draft.isPreferred}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, isPreferred: event.target.checked }))
                      }
                    />
                    <span className="settings-toggle-knob" />
                  </span>
                </label>

                <label className="settings-toggle-row">
                  <span className="settings-toggle-copy">
                    <strong>Active supplier</strong>
                    <small>Inactive suppliers remain on record but are removed from normal procurement decisions.</small>
                  </span>
                  <span className={`settings-toggle-pill${draft.isActive ? " is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, isActive: event.target.checked }))
                      }
                    />
                    <span className="settings-toggle-knob" />
                  </span>
                </label>

                <div className="soft-card-grid soft-card-grid--two">
                  <div className="suppliers-spotlight-stat">
                    <span>Lead time preview</span>
                    <strong>{draft.leadTimeDays ? `${draft.leadTimeDays} day lead` : "Unset"}</strong>
                    <small>{draft.reviewCadence || "Review cadence has not been set yet."}</small>
                  </div>
                  <div className="suppliers-spotlight-stat">
                    <span>Service target preview</span>
                    <strong>{draft.serviceLevelTarget ? `${draft.serviceLevelTarget}%` : "Unset"}</strong>
                    <small>{draft.paymentTerms || "Payment terms are still missing from the record."}</small>
                  </div>
                  <div className="suppliers-spotlight-stat">
                    <span>Order floor</span>
                    <strong>{orderFloorLabel}</strong>
                    <small>{draft.orderingCutoffTime || "Ordering cutoff is still unset for this lane."}</small>
                  </div>
                  <div className="suppliers-spotlight-stat">
                    <span>Compliance posture</span>
                    <strong>{draft.complianceTier || "Unset"}</strong>
                    <small>{draft.shipmentCadence || "Shipment cadence is still unset for this supplier."}</small>
                  </div>
                </div>
              </section>
            </div>

            <div className="form-actions">
              {isEditing ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={saving}
                >
                  <FiTrash />
                  Delete Supplier
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetDraft}
                disabled={saving || loading || !draftDirty}
              >
                {isEditing ? "Reset Changes" : "Clear Draft"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate("/suppliers")}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || loading || !draftReady || !draftDirty}
              >
                {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Supplier"}
              </button>
            </div>
          </form>
        </article>

        <aside className="supplier-studio-side">
          <article className="soft-panel supplier-studio-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Live lane context</span>
                <h3>{draft.name || "Supplier preview"}</h3>
              </div>
              <span className="status-pill small neutral">
                {analyticsSupplier ? "Analytics live" : "Awaiting history"}
              </span>
            </header>

              <div className="soft-card-grid soft-card-grid--two">
                <div className="suppliers-spotlight-stat">
                  <span>Open commitments</span>
                <strong>{openOrders.length}</strong>
                <small>{formatMoney(currency, openCommitmentValue)} still waiting to land.</small>
              </div>
              <div className="suppliers-spotlight-stat">
                <span>Next ETA</span>
                <strong>{nextEta ? formatShortDate(nextEta) : "Unset"}</strong>
                <small>{openOrders.length ? "Earliest live inbound ETA." : "No open purchase orders are linked."}</small>
              </div>
              <div className="suppliers-spotlight-stat">
                <span>Products assigned</span>
                <strong>{liveProducts.length}</strong>
                <small>Catalog lines currently sourced from this supplier.</small>
              </div>
                <div className="suppliers-spotlight-stat">
                  <span>Last delivery</span>
                  <strong>
                    {analyticsSupplier?.lastDeliveryAt ? formatDate(analyticsSupplier.lastDeliveryAt) : "No receipt yet"}
                  </strong>
                <small>
                  {analyticsSupplier
                    ? `${firstNumberFrom(analyticsSupplier, ["fillRate"]).toFixed(1)}% tracked fill rate.`
                    : "Receipt history will populate service metrics once inbound activity exists."}
                </small>
              </div>
              <div className="suppliers-spotlight-stat">
                <span>Receiving window</span>
                <strong>{draft.receivingWindow || "Unset"}</strong>
                <small>{draft.receivingDock || draft.dispatchRegion || "Dock routing has not yet been defined for this lane."}</small>
              </div>
              <div className="suppliers-spotlight-stat">
                <span>Escalation lane</span>
                <strong>{draft.escalationContact || "Unset"}</strong>
                <small>{draft.portalReference || "Portal reference has not been captured yet."}</small>
              </div>
              <div className="suppliers-spotlight-stat">
                <span>Order floor</span>
                <strong>{orderFloorLabel}</strong>
                <small>{draft.shipmentCadence || "Shipment cadence has not been captured yet."}</small>
              </div>
              <div className="suppliers-spotlight-stat">
                <span>Compliance tier</span>
                <strong>{draft.complianceTier || "Unset"}</strong>
                <small>{draft.orderingCutoffTime || "Cutoff discipline has not been captured yet."}</small>
              </div>
            </div>
          </article>

          <article className="soft-panel supplier-studio-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Lane governance</span>
                <h3>Owner readiness checks</h3>
              </div>
              <span className={`status-pill small ${governanceReadiness >= 100 ? "success" : "warning"}`}>
                {governanceReadiness}% ready
              </span>
            </header>

            <div className="inventory-catalog-checklist">
              {governanceChecklist.map((item) => (
                <article key={item.label} className="inventory-catalog-checklist-item">
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.note}</small>
                  </div>
                  <span className={`status-pill small ${item.ready ? "success" : "warning"}`}>
                    {item.ready ? "Ready" : "Pending"}
                  </span>
                </article>
              ))}
            </div>

            {draft.trackingUrl ? (
              <div className="form-actions">
                <a
                  className="btn btn-secondary"
                  href={draft.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Tracking
                </a>
              </div>
            ) : null}
          </article>

          <article className="soft-panel supplier-studio-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Live inbound lane</span>
                <h3>Recent purchase orders</h3>
              </div>
            </header>

            <div className="suppliers-route-stack">
              {liveOrders.length ? (
                liveOrders.slice(0, 5).map((order) => (
                  <article key={order?.id || `${draft.name}-${order?.expectedDate || "open"}`} className="suppliers-route-row">
                    <div className="suppliers-route-copy">
                      <strong>{order?.id || "Supplier order"}</strong>
                      <span>{order?.status || "Draft"}</span>
                      <small>
                        {order?.expectedDate ? `ETA ${formatShortDate(order.expectedDate)}.` : "ETA unset."}{" "}
                        {Number(order?.openUnits || 0) > 0 ? `${Number(order.openUnits)} units still open.` : ""}
                      </small>
                    </div>
                    <div className="suppliers-route-meta">
                      <strong>{formatMoney(currency, Number(order?.totalEstimatedCost || 0))}</strong>
                      <small>{order?.receivedAt ? "Received" : "Live inbound lane"}</small>
                    </div>
                  </article>
                ))
              ) : (
                <p className="subtle">
                  No purchase-order history is tied to this supplier yet. Create the record now and draft
                  procurement from the dedicated order page when needed.
                </p>
              )}
            </div>
          </article>
        </aside>
      </section>

      {confirmDeleteOpen && supplierId ? (
        <div className="force-pin-modal-backdrop">
          <div className="force-pin-modal inventory-action-modal inventory-action-modal--danger">
            <div className="force-pin-modal-copy">
              <p className="eyebrow">Delete Supplier</p>
              <h3>Remove supplier record</h3>
              <p>
                {draft.name || "This supplier"} will be removed from the live supplier directory. Use this only
                for invalid, duplicate, or retired records that should no longer exist in the system.
              </p>
            </div>

            <div className="soft-card-grid soft-card-grid--two">
              <div className="suppliers-spotlight-stat">
                <span>Supplier</span>
                <strong>{draft.name || "Supplier record"}</strong>
                <small>{draft.contactName || draft.email || "No primary contact is on file."}</small>
              </div>
              <div className="suppliers-spotlight-stat">
                <span>Live commitments</span>
                <strong>{openOrders.length}</strong>
                <small>Review linked commitments before removing the supplier record.</small>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDeleteOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={deleteSupplier} disabled={saving}>
                {saving ? "Deleting..." : "Delete Supplier"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SupplierStudio;
