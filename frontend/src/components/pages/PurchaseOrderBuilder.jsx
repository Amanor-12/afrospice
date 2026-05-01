import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowLeft as FiArrowLeft,
  FaBoxesPacking as FiBoxes,
  FaClipboardCheck as FiClipboard,
  FaPlus as FiPlus,
  FaTruckFast as FiTruck,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import {
  formatDate,
  formatMoney,
  getResponseData,
  toArray,
} from "./shared/dataHelpers";
import ProductMediaBadge from "./shared/ProductMediaBadge";

const PRIORITY_OPTIONS = ["Standard", "Expedite", "Critical"];
const SHIP_VIA_OPTIONS = [
  "Supplier truck",
  "Third-party courier",
  "Store pickup",
  "LTL freight",
  "Parcel",
];

const emptyDraftLine = {
  productId: "",
  qtyOrdered: 1,
  unitCost: "",
};

const emptyDraft = {
  supplier: "",
  priority: "Standard",
  expectedDate: "",
  receivingLocation: "",
  shipVia: "",
  internalReference: "",
  supplierReference: "",
  paymentTermsSnapshot: "",
  note: "",
  contactSnapshot: {
    name: "",
    email: "",
    phone: "",
  },
  items: [{ ...emptyDraftLine }],
};

function compactText(value) {
  return String(value || "").trim();
}

function toPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePrefillLine(line = {}) {
  return {
    productId: compactText(line.productId || line.id),
    productName: compactText(line.productName || line.name),
    sku: compactText(line.sku),
    supplier: compactText(line.supplier || "General Supplier") || "General Supplier",
    qtyOrdered: Math.max(1, Number(line.qtyOrdered || line.recommendedQty || 1)),
    unitCost: compactText(line.unitCost ?? line.price ?? ""),
    stock: Number(line.stock || 0),
    status: compactText(line.status),
  };
}

function buildDraftPackages(prefillDraft = {}) {
  const grouped = {};
  const items = toArray(prefillDraft?.items)
    .map(normalizePrefillLine)
    .filter((line) => line.productId);

  items.forEach((line) => {
    const supplier = compactText(line.supplier || "General Supplier") || "General Supplier";
    if (!grouped[supplier]) {
      grouped[supplier] = {
        supplier,
        priority: compactText(prefillDraft?.priority || "Standard") || "Standard",
        expectedDate: compactText(prefillDraft?.expectedDate),
        receivingLocation: compactText(prefillDraft?.receivingLocation),
        shipVia: compactText(prefillDraft?.shipVia),
        internalReference: compactText(prefillDraft?.internalReference),
        supplierReference: compactText(prefillDraft?.supplierReference),
        paymentTermsSnapshot: compactText(prefillDraft?.paymentTermsSnapshot),
        note:
          compactText(prefillDraft?.note) ||
          "Drafted from the inventory reorder planner for procurement review.",
        contactSnapshot: {
          name: compactText(prefillDraft?.contactSnapshot?.name),
          email: compactText(prefillDraft?.contactSnapshot?.email),
          phone: compactText(prefillDraft?.contactSnapshot?.phone),
        },
        items: [],
      };
    }

    grouped[supplier].items.push({
      productId: line.productId,
      qtyOrdered: line.qtyOrdered,
      unitCost: line.unitCost,
      productName: line.productName,
      sku: line.sku,
      stock: line.stock,
      status: line.status,
    });
  });

  return grouped;
}

function buildDraftFromPackage(pkg, fallbackSupplier = "", receivingLocation = "") {
  if (!pkg) {
    return {
      ...emptyDraft,
      supplier: fallbackSupplier,
      receivingLocation,
      items: [{ ...emptyDraftLine }],
    };
  }

  return {
    supplier: compactText(pkg.supplier || fallbackSupplier),
    priority: compactText(pkg.priority || "Standard") || "Standard",
    expectedDate: compactText(pkg.expectedDate),
    receivingLocation: compactText(pkg.receivingLocation || receivingLocation),
    shipVia: compactText(pkg.shipVia),
    internalReference: compactText(pkg.internalReference),
    supplierReference: compactText(pkg.supplierReference),
    paymentTermsSnapshot: compactText(pkg.paymentTermsSnapshot),
    note:
      compactText(pkg.note) ||
      "Drafted from the inventory reorder planner for procurement review.",
    contactSnapshot: {
      name: compactText(pkg.contactSnapshot?.name),
      email: compactText(pkg.contactSnapshot?.email),
      phone: compactText(pkg.contactSnapshot?.phone),
    },
    items:
      toArray(pkg.items).map((line) => ({
        productId: compactText(line.productId),
        qtyOrdered: Math.max(1, Number(line.qtyOrdered || 1)),
        unitCost: compactText(line.unitCost),
      })) || [{ ...emptyDraftLine }],
  };
}

function clonePurchaseOrderDraft(source = emptyDraft) {
  const items = toArray(source?.items);

  return {
    supplier: compactText(source?.supplier),
    priority: compactText(source?.priority || "Standard") || "Standard",
    expectedDate: compactText(source?.expectedDate),
    receivingLocation: compactText(source?.receivingLocation),
    shipVia: compactText(source?.shipVia),
    internalReference: compactText(source?.internalReference),
    supplierReference: compactText(source?.supplierReference),
    paymentTermsSnapshot: compactText(source?.paymentTermsSnapshot),
    note: compactText(source?.note),
    contactSnapshot: {
      name: compactText(source?.contactSnapshot?.name),
      email: compactText(source?.contactSnapshot?.email),
      phone: compactText(source?.contactSnapshot?.phone),
    },
    items: (items.length ? items : [{ ...emptyDraftLine }]).map((line) => ({
      productId: compactText(line?.productId),
      qtyOrdered: Math.max(1, Number(line?.qtyOrdered || 1)),
      unitCost: compactText(line?.unitCost),
    })),
  };
}

function buildDraftState(prefillDraft = {}, receivingLocation = "") {
  const packages = buildDraftPackages(prefillDraft);
  const selectedPackageKey =
    Object.keys(packages)[0] || compactText(prefillDraft?.supplier || "");
  const draft = clonePurchaseOrderDraft(
    buildDraftFromPackage(packages[selectedPackageKey], selectedPackageKey, receivingLocation)
  );

  return {
    packages,
    selectedPackageKey,
    draft,
  };
}

function buildExpectedDate(leadTimeDays) {
  const days = Number(leadTimeDays || 0);
  if (!Number.isFinite(days) || days <= 0) return "";
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function SummaryCard({ icon: Icon, label, value, note }) {
  return (
    <article className="soft-summary-card procurement-summary-card">
      <div className="soft-summary-icon">{Icon ? <Icon /> : null}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function PurchaseOrderBuilder({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currency = settings?.currency || "CAD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";
  const routePrefillDraft = useMemo(
    () => location.state?.prefillPurchaseOrderDraft || {},
    [location.state?.prefillPurchaseOrderDraft]
  );
  const defaultReceivingLocation =
    settings?.storeName || settings?.branchName || settings?.branchCode || "Main receiving";
  const initialDraftState = useMemo(
    () => buildDraftState(routePrefillDraft, defaultReceivingLocation),
    [defaultReceivingLocation, routePrefillDraft]
  );

  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [draftPackages, setDraftPackages] = useState(() => initialDraftState.packages);
  const [selectedPackageKey, setSelectedPackageKey] = useState(
    () => initialDraftState.selectedPackageKey
  );
  const [draft, setDraft] = useState(() => initialDraftState.draft);
  const [draftBaseline, setDraftBaseline] = useState(() => initialDraftState.draft);

  useEffect(() => {
    setDraftPackages(initialDraftState.packages);
    setSelectedPackageKey(initialDraftState.selectedPackageKey);
    setDraft(initialDraftState.draft);
    setDraftBaseline(initialDraftState.draft);
  }, [initialDraftState, location.key]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [suppliersResponse, productsResponse, purchaseOrdersResponse] = await Promise.all([
          API.get("/suppliers"),
          API.get("/products"),
          API.get("/purchase-orders?limit=30"),
        ]);

        if (cancelled) return;

        startTransition(() => {
          setSuppliers(toArray(getResponseData(suppliersResponse)));
          setProducts(toArray(getResponseData(productsResponse)));
          setPurchaseOrders(toArray(getResponseData(purchaseOrdersResponse)));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load the procurement builder.");
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
  }, [refreshNonce]);

  const activeSupplierProfile = useMemo(
    () =>
      suppliers.find(
        (supplier) =>
          compactText(supplier?.name).toLowerCase() ===
            compactText(draft.supplier).toLowerCase() || false
      ) || null,
    [draft.supplier, suppliers]
  );

  useEffect(() => {
    if (!activeSupplierProfile) return;

    setDraft((current) => {
      if (
        compactText(current.supplier).toLowerCase() !==
        compactText(activeSupplierProfile.name).toLowerCase()
      ) {
        return current;
      }

      const nextDraft = {
        ...current,
        expectedDate: current.expectedDate || buildExpectedDate(activeSupplierProfile.leadTimeDays),
        receivingLocation: current.receivingLocation || defaultReceivingLocation,
        paymentTermsSnapshot:
          current.paymentTermsSnapshot || compactText(activeSupplierProfile.paymentTerms),
        contactSnapshot: {
          name: current.contactSnapshot?.name || compactText(activeSupplierProfile.contactName),
          email: current.contactSnapshot?.email || compactText(activeSupplierProfile.email),
          phone: current.contactSnapshot?.phone || compactText(activeSupplierProfile.phone),
        },
      };

      const unchanged =
        JSON.stringify(nextDraft.contactSnapshot) === JSON.stringify(current.contactSnapshot) &&
        nextDraft.expectedDate === current.expectedDate &&
        nextDraft.receivingLocation === current.receivingLocation &&
        nextDraft.paymentTermsSnapshot === current.paymentTermsSnapshot;

      if (!unchanged) {
        setDraftBaseline((baseline) =>
          JSON.stringify(clonePurchaseOrderDraft(baseline)) ===
          JSON.stringify(clonePurchaseOrderDraft(current))
            ? clonePurchaseOrderDraft(nextDraft)
            : baseline
        );
      }

      return unchanged ? current : nextDraft;
    });
  }, [activeSupplierProfile, defaultReceivingLocation]);

  const supplierProductOptions = useMemo(() => {
    const supplierName = compactText(draft.supplier).toLowerCase();
    const visibleProducts = supplierName
      ? products.filter(
          (product) => compactText(product?.supplier).toLowerCase() === supplierName
        )
      : products;

    return [...visibleProducts].sort((left, right) =>
      compactText(left?.name).localeCompare(compactText(right?.name))
    );
  }, [draft.supplier, products]);

  const draftLines = useMemo(
    () =>
      draft.items
        .map((line) => {
          const product =
            products.find((item) => String(item?.id) === String(line.productId)) || null;
          if (!product) return null;

          const qtyOrdered = Math.max(1, Number(line.qtyOrdered || 1));
          const unitCost = toPositiveNumber(
            line.unitCost,
            toPositiveNumber(product?.unitCost, Number(product?.price || 0))
          );
          const currentStock = Number(product?.stock || 0);

          return {
            ...line,
            product,
            qtyOrdered,
            unitCost,
            currentStock,
            extendedCost: qtyOrdered * unitCost,
            projectedAfterReceive: currentStock + qtyOrdered,
          };
        })
        .filter(Boolean),
    [draft.items, products]
  );

  const supplierPackages = useMemo(
    () =>
      Object.values(draftPackages).map((pkg) => {
        const lines = toArray(pkg.items);
        return {
          supplier: pkg.supplier,
          units: lines.reduce(
            (sum, line) => sum + Math.max(1, Number(line.qtyOrdered || 0)),
            0
          ),
          linesCount: lines.length,
          spend: lines.reduce(
            (sum, line) =>
              sum +
              Math.max(1, Number(line.qtyOrdered || 0)) * toPositiveNumber(line.unitCost, 0),
            0
          ),
          pressureCount: lines.filter((line) =>
            ["Critical", "Reorder Soon"].includes(compactText(line.status))
          ).length,
          expectedDate: compactText(pkg.expectedDate),
          note: compactText(pkg.note),
        };
      }),
    [draftPackages]
  );

  const liveOrdersForSupplier = useMemo(
    () =>
      purchaseOrders.filter(
        (order) =>
          compactText(order?.supplier).toLowerCase() ===
          compactText(draft.supplier).toLowerCase()
      ),
    [draft.supplier, purchaseOrders]
  );

  const openOrdersForSupplier = useMemo(
    () =>
      liveOrdersForSupplier.filter(
        (order) => !["Received", "Cancelled"].includes(compactText(order?.status))
      ),
    [liveOrdersForSupplier]
  );

  const lateOrdersCount = useMemo(
    () =>
      openOrdersForSupplier.filter((order) => {
        if (!order?.expectedDate) return false;
        const eta = new Date(order.expectedDate);
        return !Number.isNaN(eta.getTime()) && eta.getTime() < Date.now();
      }).length,
    [openOrdersForSupplier]
  );

  const draftUnits = useMemo(
    () => draftLines.reduce((sum, line) => sum + Number(line.qtyOrdered || 0), 0),
    [draftLines]
  );

  const draftTotal = useMemo(
    () => draftLines.reduce((sum, line) => sum + Number(line.extendedCost || 0), 0),
    [draftLines]
  );

  const selectedPackage = useMemo(
    () => draftPackages[selectedPackageKey] || null,
    [draftPackages, selectedPackageKey]
  );
  const draftDirty = useMemo(
    () =>
      JSON.stringify(clonePurchaseOrderDraft(draft)) !==
      JSON.stringify(clonePurchaseOrderDraft(draftBaseline)),
    [draft, draftBaseline]
  );
  const draftReady = Boolean(compactText(draft.supplier) && draftLines.length);
  const draftStatusTone = !compactText(draft.supplier)
    ? "warning"
    : !draftLines.length
      ? "warning"
      : draftDirty
        ? "success"
        : "neutral";
  const draftStatusLabel = !compactText(draft.supplier)
    ? "Supplier needed"
    : !draftLines.length
      ? "Lines needed"
      : draftDirty
        ? "Ready"
        : selectedPackage
          ? "Package ready"
          : "Draft ready";
  const draftStatusTitle = !compactText(draft.supplier)
    ? "Choose a supplier before this purchase order can move forward."
    : !draftLines.length
      ? "Add at least one valid inbound line before drafting the order."
      : draftDirty
        ? "This inbound order is ready for procurement review."
        : selectedPackage
          ? `${selectedPackage.supplier} is loaded from the grouped supplier queue.`
          : "This manual purchase-order draft is staged and ready.";
  const draftStatusNote = !compactText(draft.supplier)
    ? "Supplier selection anchors payment terms, contact defaults, and live inbound exposure."
    : !draftLines.length
      ? "Choose line items to turn this envelope into an actionable inbound order."
      : draftDirty
        ? "Create the draft now or restore the baseline package if you want to discard local edits."
        : selectedPackage
          ? "The grouped supplier package is loaded without local overrides. You can draft it immediately or edit it first."
          : "This manual draft has no local edits yet, but it already meets the minimum requirements for creation.";
  const resetDraftLabel = selectedPackage ? "Restore Package" : "Reset Draft";

  const summaryCards = [
    {
      icon: FiTruck,
      label: "Open Commitments",
      value: `${openOrdersForSupplier.length}`,
      note: draft.supplier
        ? `${lateOrdersCount} supplier orders are already beyond ETA.`
        : "Choose a supplier to inspect live inbound exposure.",
    },
    {
      icon: FiBoxes,
      label: "Draft Units",
      value: `${draftUnits}`,
      note: `${draftLines.length} live lines are staged in the current order.`,
    },
    {
      icon: FiClipboard,
      label: "Estimated Spend",
      value: formatMoney(currency, draftTotal),
      note: activeSupplierProfile?.paymentTerms
        ? `${activeSupplierProfile.paymentTerms} terms are on record for this lane.`
        : "Payment terms are not yet captured for this supplier.",
    },
  ];

  const setDraftField = (field, value) =>
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));

  const setContactField = (field, value) =>
    setDraft((current) => ({
      ...current,
      contactSnapshot: {
        ...current.contactSnapshot,
        [field]: value,
      },
    }));

  const selectPackage = (supplierName) => {
    const pkg = draftPackages[supplierName];
    const nextDraft = clonePurchaseOrderDraft(
      buildDraftFromPackage(pkg, supplierName, defaultReceivingLocation)
    );
    setSelectedPackageKey(supplierName);
    setDraft(nextDraft);
    setDraftBaseline(nextDraft);
    setError("");
    setNotice("");
  };

  const updateDraftLine = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              [field]:
                field === "qtyOrdered"
                  ? Math.max(1, Number(value || 1))
                  : String(value || ""),
            }
          : line
      ),
    }));
  };

  const addDraftLine = () =>
    setDraft((current) => ({
      ...current,
      items: [...current.items, { ...emptyDraftLine }],
    }));

  const removeDraftLine = (index) =>
    setDraft((current) => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, lineIndex) => lineIndex !== index),
    }));

  const resetDraft = () => {
    setDraft(clonePurchaseOrderDraft(draftBaseline));
    setError("");
    setNotice("");
  };

  const createCurrentDraft = async (event) => {
    event.preventDefault();
    if (saving || bulkSaving) return;

    const supplier = compactText(draft.supplier);
    const items = draft.items
      .map((line) => ({
        productId: Number(line.productId || 0),
        qtyOrdered: Math.max(1, Number(line.qtyOrdered || 1)),
        unitCost: toPositiveNumber(line.unitCost, 0),
      }))
      .filter((line) => line.productId > 0);

    if (!supplier) {
      setError("Choose a supplier before drafting the purchase order.");
      return;
    }

    if (!items.length) {
      setError("Add at least one valid inbound line before drafting the order.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const response = await API.post("/purchase-orders", {
        supplier,
        priority: draft.priority,
        expectedDate: draft.expectedDate || null,
        receivingLocation: draft.receivingLocation,
        shipVia: draft.shipVia,
        internalReference: draft.internalReference,
        supplierReference: draft.supplierReference,
        paymentTermsSnapshot: draft.paymentTermsSnapshot,
        note: draft.note || "",
        contactSnapshot: draft.contactSnapshot,
        items,
      });

      const order = getResponseData(response);
      const nextPackages = { ...draftPackages };
      const matchesSelectedPackage =
        selectedPackageKey &&
        compactText(selectedPackageKey).toLowerCase() === supplier.toLowerCase();
      if (matchesSelectedPackage && nextPackages[selectedPackageKey]) {
        delete nextPackages[selectedPackageKey];
      }
      const nextKey = Object.keys(nextPackages)[0] || "";
      const nextDraft = clonePurchaseOrderDraft(
        nextKey
          ? buildDraftFromPackage(
              nextPackages[nextKey],
              nextKey,
              defaultReceivingLocation
            )
          : {
              ...emptyDraft,
              supplier,
              receivingLocation: defaultReceivingLocation,
              items: [{ ...emptyDraftLine }],
            }
      );

      setDraftPackages(nextPackages);
      setSelectedPackageKey(nextKey);
      setDraft(nextDraft);
      setDraftBaseline(nextDraft);
      setNotice(`Purchase order ${order?.id || ""} drafted for ${supplier}.`);
      setRefreshNonce((value) => value + 1);
    } catch (submitError) {
      setError(submitError?.message || "Could not create the purchase order.");
    } finally {
      setSaving(false);
    }
  };

  const createAllDrafts = async () => {
    if (saving || bulkSaving) return;

    const packages = Object.values(draftPackages);
    if (!packages.length) {
      setError("There are no grouped supplier drafts waiting to be created.");
      return;
    }

    try {
      setBulkSaving(true);
      setError("");
      setNotice("");

      for (const pkg of packages) {
        await API.post("/purchase-orders", {
          supplier: compactText(pkg.supplier),
          priority: compactText(pkg.priority || "Standard") || "Standard",
          expectedDate: compactText(pkg.expectedDate) || null,
          receivingLocation:
            compactText(pkg.receivingLocation) || defaultReceivingLocation,
          shipVia: compactText(pkg.shipVia),
          internalReference: compactText(pkg.internalReference),
          supplierReference: compactText(pkg.supplierReference),
          paymentTermsSnapshot: compactText(pkg.paymentTermsSnapshot),
          note: compactText(pkg.note),
          contactSnapshot: pkg.contactSnapshot || emptyDraft.contactSnapshot,
          items: toArray(pkg.items).map((line) => ({
            productId: Number(line.productId || 0),
            qtyOrdered: Math.max(1, Number(line.qtyOrdered || 1)),
            unitCost: toPositiveNumber(line.unitCost, 0),
          })),
        });
      }

      setDraftPackages({});
      setSelectedPackageKey("");
      const nextDraft = clonePurchaseOrderDraft({
        ...emptyDraft,
        receivingLocation: defaultReceivingLocation,
        items: [{ ...emptyDraftLine }],
      });
      setDraft(nextDraft);
      setDraftBaseline(nextDraft);
      setNotice(
        `${packages.length} supplier draft${packages.length === 1 ? "" : "s"} created successfully.`
      );
      setRefreshNonce((value) => value + 1);
    } catch (submitError) {
      setError(submitError?.message || "Could not create all supplier drafts.");
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="page-container purchase-orders-builder-page procurement-builder-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="procurement-builder-hero">
        <div className="procurement-builder-hero-copy">
          <span className="reference-page-kicker">Procurement control</span>
          <h1>Create supplier orders in a real inbound workflow.</h1>
          <p>
            Build purchase orders with supplier context, receiving posture, line economics,
            and open commitment visibility before anything is drafted into the live ledger.
          </p>

          <div className="reference-page-heading-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/pos-dashboard")}
            >
              <FiArrowLeft />
              Back to Inventory
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/suppliers")}
            >
              Supplier Directory
            </button>
            {supplierPackages.length > 1 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={createAllDrafts}
                disabled={bulkSaving}
              >
                {bulkSaving ? "Creating drafts..." : `Create ${supplierPackages.length} Orders`}
              </button>
            ) : null}
          </div>
        </div>

        <aside className="procurement-builder-hero-aside">
          <div className="procurement-brief-grid">
            {summaryCards.map((card) => (
              <SummaryCard
                key={card.label}
                icon={card.icon}
                label={card.label}
                value={card.value}
                note={card.note}
              />
            ))}
          </div>
        </aside>
      </section>

      {supplierPackages.length ? (
        <section className="procurement-builder-package-grid">
          {supplierPackages.map((pkg) => (
            <button
              key={pkg.supplier}
              type="button"
              className={`procurement-builder-package-card${
                selectedPackageKey === pkg.supplier ? " active" : ""
              }`}
              onClick={() => selectPackage(pkg.supplier)}
            >
              <div className="procurement-builder-package-head">
                <span className="reference-page-kicker">Grouped lane</span>
                <span className="status-pill small neutral">{pkg.linesCount} lines</span>
              </div>
              <strong>{pkg.supplier}</strong>
              <small>
                {pkg.units} units / {formatMoney(currency, pkg.spend)}
              </small>
              <p>
                {pkg.pressureCount
                  ? `${pkg.pressureCount} lines are under active stock pressure.`
                  : "Ready for normal procurement review."}
              </p>
            </button>
          ))}
        </section>
      ) : null}

      <section className="procurement-builder-shell">
        <div className="procurement-builder-main">
          <article className="soft-panel procurement-builder-panel">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Order envelope</span>
                <h2>Inbound draft composer</h2>
                <p className="subtle">
                  Capture supplier, receiving, commercial, and line-level detail in one
                  deliberate procurement flow.
                </p>
              </div>
              <div className="workspace-pill-row">
                <span className="status-pill small neutral">{draftLines.length} live lines</span>
                <span className="status-pill small success">{formatMoney(currency, draftTotal)}</span>
              </div>
            </header>

            <div className={`procurement-builder-status-bar${draftDirty ? " is-dirty" : ""}`}>
              <div className="procurement-builder-status-copy">
                <strong>{draftStatusTitle}</strong>
                <small>{draftStatusNote}</small>
              </div>
              <div className="procurement-builder-status-actions">
                <span className={`status-pill small ${draftStatusTone}`}>{draftStatusLabel}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetDraft}
                  disabled={saving || bulkSaving || loading || !draftDirty}
                >
                  {resetDraftLabel}
                </button>
              </div>
            </div>

            <form className="stack-form premium-form" onSubmit={createCurrentDraft}>
              <div className="procurement-envelope-grid">
                <label className="field-shell">
                  <span className="field-label">Supplier</span>
                  <select
                    className="input"
                    value={draft.supplier}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        supplier: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select supplier</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.name}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-shell">
                  <span className="field-label">Priority</span>
                  <select
                    className="input"
                    value={draft.priority}
                    onChange={(event) => setDraftField("priority", event.target.value)}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-shell">
                  <span className="field-label">Expected arrival</span>
                  <input
                    className="input"
                    type="date"
                    value={draft.expectedDate}
                    onChange={(event) => setDraftField("expectedDate", event.target.value)}
                  />
                </label>

                <label className="field-shell">
                  <span className="field-label">Receiving location</span>
                  <input
                    className="input"
                    value={draft.receivingLocation}
                    onChange={(event) =>
                      setDraftField("receivingLocation", event.target.value)
                    }
                    placeholder={defaultReceivingLocation}
                  />
                </label>

                <label className="field-shell">
                  <span className="field-label">Ship via</span>
                  <input
                    className="input"
                    list="ship-via-options"
                    value={draft.shipVia}
                    onChange={(event) => setDraftField("shipVia", event.target.value)}
                    placeholder="Supplier truck"
                  />
                  <datalist id="ship-via-options">
                    {SHIP_VIA_OPTIONS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </label>

                <label className="field-shell">
                  <span className="field-label">Internal reference</span>
                  <input
                    className="input"
                    value={draft.internalReference}
                    onChange={(event) =>
                      setDraftField("internalReference", event.target.value)
                    }
                    placeholder="PO review tag, event, or replenishment wave"
                  />
                </label>

                <label className="field-shell">
                  <span className="field-label">Supplier reference</span>
                  <input
                    className="input"
                    value={draft.supplierReference}
                    onChange={(event) =>
                      setDraftField("supplierReference", event.target.value)
                    }
                    placeholder="Quote, rep, or supplier PO reference"
                  />
                </label>

                <label className="field-shell">
                  <span className="field-label">Payment terms snapshot</span>
                  <input
                    className="input"
                    value={draft.paymentTermsSnapshot}
                    onChange={(event) =>
                      setDraftField("paymentTermsSnapshot", event.target.value)
                    }
                    placeholder="Net 30"
                  />
                </label>
              </div>

              <div className="procurement-contact-grid">
                <label className="field-shell">
                  <span className="field-label">Supplier contact</span>
                  <input
                    className="input"
                    value={draft.contactSnapshot.name}
                    onChange={(event) => setContactField("name", event.target.value)}
                    placeholder="Primary supplier contact"
                  />
                </label>
                <label className="field-shell">
                  <span className="field-label">Contact email</span>
                  <input
                    className="input"
                    type="email"
                    value={draft.contactSnapshot.email}
                    onChange={(event) => setContactField("email", event.target.value)}
                    placeholder="orders@supplier.com"
                  />
                </label>
                <label className="field-shell">
                  <span className="field-label">Contact phone</span>
                  <input
                    className="input"
                    value={draft.contactSnapshot.phone}
                    onChange={(event) => setContactField("phone", event.target.value)}
                    placeholder="416-555-0100"
                  />
                </label>
              </div>

              <label className="field-shell">
                <span className="field-label">Receiving note</span>
                <textarea
                  className="input textarea"
                  rows="4"
                  value={draft.note}
                  onChange={(event) => setDraftField("note", event.target.value)}
                  placeholder="Dock instructions, receiving notes, temperature handling, urgency, freight detail..."
                />
              </label>

              <div className="procurement-line-sheet">
                <div className="soft-panel-header procurement-line-sheet-head">
                  <div>
                    <span className="reference-page-kicker">Line planning</span>
                    <h3>Product, quantity, cost, and projected receiving impact</h3>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={addDraftLine}
                  >
                    <FiPlus />
                    Add Line
                  </button>
                </div>

                <div className="procurement-line-list">
                  {draft.items.map((line, index) => {
                    const product =
                      products.find((item) => String(item?.id) === String(line.productId)) || null;
                    const qtyOrdered = Math.max(1, Number(line.qtyOrdered || 1));
                    const unitCost = toPositiveNumber(
                      line.unitCost,
                      toPositiveNumber(product?.unitCost, Number(product?.price || 0))
                    );
                    const currentStock = Number(product?.stock || 0);

                    return (
                      <article key={`po-line-${index}`} className="procurement-line-card">
                        <div className="procurement-line-main">
                          <div className="procurement-line-product">
                            <ProductMediaBadge
                              product={product || { name: line.productName || "Product" }}
                              className="procurement-line-media"
                            />

                            <div className="procurement-line-copy">
                              <label className="field-shell premium-line-field premium-line-field--grow">
                                <span className="field-label">Product</span>
                                <select
                                  className="input"
                                  value={line.productId}
                                  onChange={(event) =>
                                    updateDraftLine(index, "productId", event.target.value)
                                  }
                                >
                                  <option value="">Select product</option>
                                  {supplierProductOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name} - {option.stock} in stock
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <div className="procurement-line-meta">
                                <span>{product?.sku || "SKU pending"}</span>
                                <span>{product?.category || "General"}</span>
                                <span>{product?.supplier || draft.supplier || "Supplier pending"}</span>
                              </div>
                            </div>
                          </div>

                          <div className="procurement-line-fields">
                            <label className="field-shell premium-line-field">
                              <span className="field-label">Qty</span>
                              <input
                                className="input"
                                type="number"
                                min="1"
                                value={line.qtyOrdered}
                                onChange={(event) =>
                                  updateDraftLine(index, "qtyOrdered", event.target.value)
                                }
                              />
                            </label>

                            <label className="field-shell premium-line-field">
                              <span className="field-label">Unit cost</span>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.unitCost}
                                onChange={(event) =>
                                  updateDraftLine(index, "unitCost", event.target.value)
                                }
                                placeholder={String(product?.unitCost || product?.price || "")}
                              />
                            </label>
                          </div>
                        </div>

                        <div className="procurement-line-stats">
                          <div className="procurement-line-stat">
                            <span>Current stock</span>
                            <strong>{currentStock}</strong>
                          </div>
                          <div className="procurement-line-stat">
                            <span>Projected stock</span>
                            <strong>{currentStock + qtyOrdered}</strong>
                          </div>
                          <div className="procurement-line-stat">
                            <span>Extended cost</span>
                            <strong>{formatMoney(currency, qtyOrdered * unitCost)}</strong>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary btn-icon"
                            onClick={() => removeDraftLine(index)}
                            disabled={draft.items.length === 1}
                            aria-label="Remove purchase-order line"
                          >
                            x
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetDraft}
                  disabled={saving || bulkSaving || loading || !draftDirty}
                >
                  {resetDraftLabel}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || loading || bulkSaving || !draftReady}
                >
                  {saving ? "Drafting..." : "Draft Purchase Order"}
                </button>
              </div>
            </form>
          </article>
        </div>

        <aside className="procurement-builder-side">
          <article className="soft-panel procurement-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Supplier lane</span>
                <h2>{draft.supplier || "Select a supplier"}</h2>
              </div>
              <span
                className={`status-pill small ${activeSupplierProfile?.isPreferred ? "warning" : "neutral"}`}
              >
                {activeSupplierProfile?.isPreferred ? "Preferred" : "Open lane"}
              </span>
            </header>

            <div className="procurement-side-metrics">
              <div className="procurement-side-metric">
                <span>Lead time</span>
                <strong>
                  {activeSupplierProfile?.leadTimeDays
                    ? `${activeSupplierProfile.leadTimeDays} days`
                    : "Not set"}
                </strong>
              </div>
              <div className="procurement-side-metric">
                <span>Service target</span>
                <strong>
                  {activeSupplierProfile?.serviceLevelTarget
                    ? `${Number(activeSupplierProfile.serviceLevelTarget).toFixed(0)}%`
                    : "Unset"}
                </strong>
              </div>
              <div className="procurement-side-metric">
                <span>Payment terms</span>
                <strong>{draft.paymentTermsSnapshot || "Not captured"}</strong>
              </div>
              <div className="procurement-side-metric">
                <span>Open commitments</span>
                <strong>{openOrdersForSupplier.length}</strong>
              </div>
            </div>

            <p className="subtle">
              {activeSupplierProfile?.reviewCadence
                ? `${activeSupplierProfile.reviewCadence}. ${activeSupplierProfile.notes || ""}`
                : activeSupplierProfile?.notes ||
                  "Supplier notes, review cadence, and service expectations appear here once the record is complete."}
            </p>
          </article>

          <article className="soft-panel procurement-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Inbound queue</span>
                <h2>Live purchase-order lane</h2>
              </div>
              <span className="status-pill small neutral">{openOrdersForSupplier.length} open</span>
            </header>

            <div className="procurement-queue-list">
              {loading ? (
                <p className="subtle">Loading purchase-order history...</p>
              ) : liveOrdersForSupplier.length ? (
                liveOrdersForSupplier.slice(0, 6).map((order) => (
                  <article key={order?.id} className="procurement-queue-row">
                    <div>
                      <strong>{order?.id || "Draft order"}</strong>
                      <small>
                        {order?.status || "Draft"} /{" "}
                        {order?.expectedDate ? formatDate(order.expectedDate) : "No ETA"}
                      </small>
                    </div>
                    <div className="procurement-queue-meta">
                      <strong>{formatMoney(currency, order?.totalEstimatedCost)}</strong>
                      <small>{order?.priority || "Standard"}</small>
                    </div>
                  </article>
                ))
              ) : (
                <p className="subtle">
                  {draft.supplier
                    ? "No purchase-order history was returned for this supplier yet."
                    : "Choose a supplier to inspect live inbound history."}
                </p>
              )}
            </div>
          </article>

          <article className="soft-panel procurement-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Draft posture</span>
                <h2>Current order summary</h2>
              </div>
              <span className="status-pill small success">{formatMoney(currency, draftTotal)}</span>
            </header>

            <div className="procurement-side-metrics">
              <div className="procurement-side-metric">
                <span>Supplier drafts</span>
                <strong>{supplierPackages.length || 1}</strong>
              </div>
              <div className="procurement-side-metric">
                <span>Units staged</span>
                <strong>{draftUnits}</strong>
              </div>
              <div className="procurement-side-metric">
                <span>Receiving site</span>
                <strong>{draft.receivingLocation || defaultReceivingLocation}</strong>
              </div>
              <div className="procurement-side-metric">
                <span>Selected package</span>
                <strong>{selectedPackage?.supplier || "Manual draft"}</strong>
              </div>
            </div>

            <p className="subtle">
              {selectedPackage?.note ||
                "Use this builder to separate supplier governance from the live inventory table while keeping the resulting draft fully actionable."}
            </p>
          </article>
        </aside>
      </section>
    </div>
  );
}

export default PurchaseOrderBuilder;
