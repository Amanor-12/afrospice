import { resolveProductImage } from "../shared/productMedia";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value) {
  return `USD ${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value) {
  return `${toNumber(value).toFixed(1)}%`;
}

function describeMode(editingId) {
  return editingId ? "Editing live SKU" : "New catalog intake";
}

function describeLookupKey(formData = {}) {
  return formData.sku || formData.barcode || "Awaiting identity";
}

function describeReceivingRoute(formData = {}) {
  return formData.shelfLocation || formData.supplier || "No routing yet";
}

function describePublishingReadiness(formData = {}) {
  const requiredFields = [
    formData.name,
    formData.sku,
    formData.category,
    formData.price,
  ];

  return requiredFields.every((value) => String(value || "").trim()) ? "Ready to publish" : "Needs detail";
}

function normalizeLookup(value) {
  return String(value || "").trim().toLowerCase();
}

const TAX_POLICY_OPTIONS = [
  { value: "ZERO_RATED_GROCERY", label: "Basic grocery", note: "0% Ontario tax" },
  { value: "HST_STANDARD", label: "Ontario HST", note: "13% standard taxable item" },
  { value: "HST_SOFT_DRINK", label: "Taxable soft drink", note: "13% beverage tax class" },
  { value: "HST_SNACK", label: "Taxable snack food", note: "13% snack tax class" },
  { value: "HST_PREPARED_FOOD", label: "Taxable prepared food", note: "13% prepared-food tax class" },
];

const CATEGORY_TAX_DEFAULTS = {
  "food staples": "ZERO_RATED_GROCERY",
  "cooking essentials": "ZERO_RATED_GROCERY",
  groceries: "ZERO_RATED_GROCERY",
  dairy: "ZERO_RATED_GROCERY",
  bakery: "ZERO_RATED_GROCERY",
  "meat & protein": "ZERO_RATED_GROCERY",
  snacks: "HST_SNACK",
  drinks: "HST_SOFT_DRINK",
};

function getTaxPolicyDetails(formData = {}) {
  const explicit = TAX_POLICY_OPTIONS.find((option) => option.value === String(formData.taxClass || "").trim());
  if (explicit) {
    return {
      title: explicit.label,
      note: explicit.note,
      source: "Manual override",
    };
  }

  const derivedCode = CATEGORY_TAX_DEFAULTS[normalizeLookup(formData.category)] || "HST_STANDARD";
  const derived = TAX_POLICY_OPTIONS.find((option) => option.value === derivedCode) || TAX_POLICY_OPTIONS[1];
  return {
    title: `${derived.label} (auto)`,
    note: derived.note,
    source: formData.category ? "Derived from category" : "Will derive at publish",
  };
}

function CommandDockPanel({
  editingId,
  scanRef,
  scanValue,
  formData,
  suppliers = [],
  loading,
  submitDisabled = false,
  resetDisabled = false,
  resetLabel = "Reset Intake",
  onScanValueChange,
  onScanSubmit,
  onChange,
  onImageUpload,
  onRemoveImage,
  onSubmit,
  onReset,
  onOpenSupplierStudio,
  operationsRail,
}) {
  const price = toNumber(formData.price);
  const unitCost = toNumber(formData.unitCost);
  const stock = Math.max(0, toInteger(formData.stock));
  const casePack = Math.max(0, toInteger(formData.casePack));
  const reorderPoint = Math.max(0, toInteger(formData.reorderPoint));
  const parLevel = Math.max(reorderPoint, Math.max(0, toInteger(formData.parLevel)));
  const stockValue = stock * (unitCost > 0 ? unitCost : price);
  const grossMarginPct = price > 0 ? ((price - unitCost) / price) * 100 : 0;
  const publishReadiness = describePublishingReadiness(formData);
  const taxPolicy = getTaxPolicyDetails(formData);
  const supplierNames = Array.from(
    new Set(
      [...suppliers.map((supplier) => String(supplier?.name || "").trim()), String(formData.supplier || "").trim()].filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
  const selectedSupplier =
    suppliers.find((supplier) => normalizeLookup(supplier?.name) === normalizeLookup(formData.supplier)) || null;
  const previewImage = resolveProductImage(formData);
  const hasCustomImage = Boolean(String(formData.imageUrl || "").trim());
  const supplierSignals = [
    {
      label: "Payment terms",
      value: selectedSupplier?.paymentTerms || "Unset",
      note: selectedSupplier?.reviewCadence || "Commercial review cadence is not captured yet.",
    },
    {
      label: "Inbound policy",
      value: selectedSupplier?.shipmentCadence || "Unset",
      note: selectedSupplier?.orderingCutoffTime || "Ordering cutoff is not captured yet.",
    },
    {
      label: "Minimum buy",
      value:
        selectedSupplier?.minimumOrderValue || selectedSupplier?.minimumOrderUnits
          ? [
              selectedSupplier?.minimumOrderValue ? formatMoney(selectedSupplier.minimumOrderValue) : null,
              selectedSupplier?.minimumOrderUnits ? `${selectedSupplier.minimumOrderUnits} units` : null,
            ]
              .filter(Boolean)
              .join(" / ")
          : "Unset",
      note: selectedSupplier?.logisticsMode || "Minimum order governance is not captured yet.",
    },
    {
      label: "Receiving route",
      value: selectedSupplier?.receivingDock || selectedSupplier?.receivingWindow || "Unset",
      note: selectedSupplier?.dispatchRegion || "Receiving dock and route guidance are still missing.",
    },
    {
      label: "Compliance tier",
      value: selectedSupplier?.complianceTier || "Unset",
      note: selectedSupplier?.escalationContact || "Escalation contact is not captured yet.",
    },
    {
      label: "Tracking posture",
      value: selectedSupplier?.trackingUrl ? "Tracking live" : "No tracker",
      note: selectedSupplier?.portalReference || "Portal reference is not captured yet.",
    },
  ];

  const intakeSummary = [
    {
      label: "Intake mode",
      value: describeMode(editingId),
      note: editingId
        ? "Changes write back into the active product record."
        : "Stage a new product with receiving and replenishment policy before it lands in the live catalog.",
    },
    {
      label: "Lookup key",
      value: describeLookupKey(formData),
      note: "The SKU or barcode used by scan, search, checkout, and receiving.",
    },
    {
      label: "Receiving route",
      value: describeReceivingRoute(formData),
      note: "Supplier or shelf location that helps staff route this item correctly on arrival.",
    },
    {
      label: "Publish posture",
      value: publishReadiness,
      note: "Name, SKU, category, and price are the minimum identity and commercial controls.",
    },
  ];

  const governanceChecklist = [
    {
      label: "Identity complete",
      ready: Boolean(String(formData.name || "").trim() && String(formData.sku || "").trim()),
      note: "Product name and SKU are ready for catalog indexing.",
    },
    {
      label: "Commercial values set",
      ready: price > 0 && unitCost >= 0,
      note: "Price and unit cost will feed margin, revenue, and stock valuation.",
    },
    {
      label: "Replenishment policy set",
      ready: reorderPoint > 0 || parLevel > 0,
      note: "Reorder point and par level drive cleaner replenishment planning.",
    },
    {
      label: "Tax policy aligned",
      ready: Boolean(String(formData.category || "").trim() || String(formData.taxClass || "").trim()),
      note: "Category or manual tax policy is needed so checkout tax behavior stays trustworthy.",
    },
    {
      label: "Receiving route set",
      ready: Boolean(String(formData.supplier || "").trim() || String(formData.shelfLocation || "").trim()),
      note: "Supplier or shelf location keeps receiving and put-away disciplined.",
    },
  ];

  const operationalSignals = [
    {
      label: "Estimated stock value",
      value: formatMoney(stockValue),
      note: `${stock} ${String(formData.unitLabel || "units").trim() || "units"} on hand at current catalog pricing.`,
    },
    {
      label: "Gross margin posture",
      value: price > 0 ? formatPercent(grossMarginPct) : "Awaiting price",
      note: unitCost > 0
        ? "Based on the staged selling price versus unit cost."
        : "Add a unit cost to make profit reporting trustworthy.",
    },
    {
      label: "Reorder policy",
      value: reorderPoint > 0 ? `${reorderPoint} trigger / ${parLevel || reorderPoint} target` : "Using global fallback",
      note: casePack > 1
        ? `Purchase quantities will round to case packs of ${casePack}.`
        : "Order quantities can be drafted as single units.",
    },
    {
      label: "Tax policy",
      value: taxPolicy.title,
      note: `${taxPolicy.note}. ${taxPolicy.source}.`,
    },
    {
      label: "Receiving note",
      value: String(formData.receivingNotes || "").trim() || "No handling note",
      note: "Capture temperature, fragility, or receiving discipline for the team.",
    },
  ];

  return (
    <div className="soft-panel soft-panel--compact inventory-command-panel">
      <div className="panel-header soft-panel-header inventory-command-panel-head">
        <div>
          <span className="reference-page-kicker">{editingId ? "Catalog Edit" : "Catalog Intake"}</span>
          <h3>{editingId ? `Edit ${formData.name || "inventory record"}` : "Stage a live inventory record"}</h3>
          <p className="panel-subtitle">
            {editingId
              ? "Update this product's identity, commercial values, stock policy, supplier route, and catalog media before saving the live record."
              : "Build the item identity, commercial values, replenishment policy, and receiving route before the SKU enters the live catalog."}
          </p>
        </div>
        <span className={`status-pill ${editingId ? "warning" : "success"}`}>
          {editingId ? "Edit mode" : "New intake"}
        </span>
      </div>

      <div className="inventory-catalog-summary">
        {intakeSummary.map((item) => (
          <article key={item.label} className="inventory-catalog-summary-card">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </article>
        ))}
      </div>

      <div className="inventory-catalog-layout">
        <div className="inventory-catalog-main">
          <section className="inventory-catalog-block inventory-catalog-block--scan">
            <div className="inventory-dock-section-head">
              <div>
                <span>Scanner intake</span>
                <strong>{editingId ? "Load another SKU or keep editing this record" : "Load an existing SKU or start a new item"}</strong>
              </div>
              <small>
                {editingId
                  ? "Scanning another SKU swaps the form into that product's edit state."
                  : "Barcodes and SKUs are matched before the form drops into create mode."}
              </small>
            </div>

            <form className="stack-form inventory-scan-form" onSubmit={onScanSubmit}>
              <label className="field-label inventory-dock-field inventory-dock-field--wide">
                <span>Barcode or SKU</span>
                <div className="inventory-scan-row">
                  <input
                    ref={scanRef}
                    className="input inventory-scan-input"
                    placeholder="Scan barcode or enter SKU"
                    value={scanValue}
                    onChange={(event) => onScanValueChange(event.target.value)}
                  />
                  <button type="submit" className="btn btn-primary">
                    Load Record
                  </button>
                </div>
              </label>
            </form>
          </section>

          <form className="stack-form inventory-dock-form" onSubmit={onSubmit}>
            <section className="inventory-catalog-block">
              <div className="inventory-dock-section-head">
                <div>
                  <span>Identity and lookup</span>
                  <strong>Name, SKU, barcode, and category</strong>
                </div>
                <small>These fields power scan lookup, the POS catalog, and reporting drilldowns.</small>
              </div>

              <div className="inventory-dock-grid">
                <label className="field-label inventory-dock-field inventory-dock-field--wide">
                  <span>Product name</span>
                  <input
                    name="name"
                    className="input"
                    placeholder="Product name"
                    value={formData.name}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>SKU</span>
                  <input
                    name="sku"
                    className="input"
                    placeholder="SKU"
                    value={formData.sku}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Barcode</span>
                  <input
                    name="barcode"
                    className="input"
                    placeholder="Barcode"
                    value={formData.barcode}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Category</span>
                  <input
                    name="category"
                    className="input"
                    placeholder="Category"
                    value={formData.category}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Unit label</span>
                  <input
                    name="unitLabel"
                    className="input"
                    placeholder="unit, bag, case, bottle"
                    value={formData.unitLabel}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Case pack</span>
                  <input
                    name="casePack"
                    type="number"
                    min="0"
                    step="1"
                    className="input"
                    placeholder="0"
                    value={formData.casePack}
                    onChange={onChange}
                  />
                </label>
              </div>
            </section>

            <section className="inventory-catalog-block">
              <div className="inventory-dock-section-head">
                <div>
                  <span>Catalog media</span>
                  <strong>Product photo and smart cover handling</strong>
                </div>
                <small>
                  Upload a real product image for the owner surface, or let AfroSpice keep the catalog visually complete
                  with an automatic smart cover.
                </small>
              </div>

              <div className="inventory-media-studio">
                <div className={`inventory-media-preview${previewImage ? "" : " is-empty"}`}>
                  {previewImage ? (
                    <img src={previewImage} alt={formData.name || "Product preview"} />
                  ) : (
                    <div className="inventory-media-preview-copy">
                      <strong>No product photo yet</strong>
                      <small>Upload a product image or let the catalog use a smart fallback once the item identity is set.</small>
                    </div>
                  )}
                  <span className={`inventory-media-preview-badge${hasCustomImage ? " is-owner" : ""}`}>
                    {hasCustomImage ? "Owner photo" : previewImage ? "Smart cover" : "Awaiting media"}
                  </span>
                </div>

                <div className="inventory-media-controls">
                  <label className="inventory-media-upload">
                    <span>Upload product photo</span>
                    <strong>PNG, JPG, WebP, GIF, or AVIF up to 2 MB</strong>
                    <small>The image is saved with the inventory record and reused across the catalog.</small>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={onImageUpload} />
                  </label>

                  <label className="field-label inventory-dock-field inventory-dock-field--wide">
                    <span>Product image URL</span>
                    <input
                      name="imageUrl"
                      className="input"
                      placeholder="https://... or leave empty to use the smart cover"
                      value={formData.imageUrl}
                      onChange={onChange}
                    />
                  </label>

                  <div className="inventory-catalog-policy-actions">
                    <button type="button" className="btn btn-secondary" onClick={onRemoveImage} disabled={!hasCustomImage}>
                      Remove uploaded photo
                    </button>
                  </div>

                  <div className="inventory-command-note inventory-command-note--support">
                    If no owner photo is attached, the inventory experience stays presentation-ready by falling back to the
                    catalog's smart product cover based on the product name, SKU, and barcode.
                  </div>
                </div>
              </div>
            </section>

            <section className="inventory-catalog-block">
              <div className="inventory-dock-section-head">
                <div>
                  <span>Commercial and stock</span>
                  <strong>Price, cost, on-hand units, and replenishment policy</strong>
                </div>
                <small>These values feed stock valuation, reorder planning, and commercial reporting.</small>
              </div>

              <div className="inventory-dock-grid inventory-dock-grid--metrics">
                <label className="field-label inventory-dock-field">
                  <span>Unit price</span>
                  <input
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    placeholder="0.00"
                    value={formData.price}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Unit cost</span>
                  <input
                    name="unitCost"
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    placeholder="0.00"
                    value={formData.unitCost}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>On-hand quantity</span>
                  <input
                    name="stock"
                    type="number"
                    min="0"
                    step="1"
                    className="input"
                    placeholder="0"
                    value={formData.stock}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Reorder point</span>
                  <input
                    name="reorderPoint"
                    type="number"
                    min="0"
                    step="1"
                    className="input"
                    placeholder="0"
                    value={formData.reorderPoint}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Par level</span>
                  <input
                    name="parLevel"
                    type="number"
                    min="0"
                    step="1"
                    className="input"
                    placeholder="0"
                    value={formData.parLevel}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field">
                  <span>Tax policy</span>
                  <select name="taxClass" className="toolbar-select" value={formData.taxClass} onChange={onChange}>
                    <option value="">Auto-derive at publish</option>
                    {TAX_POLICY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="inventory-catalog-block">
              <div className="inventory-dock-section-head">
                <div>
                  <span>Receiving and routing</span>
                  <strong>Supplier lane, shelf location, and intake notes</strong>
                </div>
                <small>Operations staff use this to route the item correctly after receiving and during replenishment.</small>
              </div>

              <div className="inventory-dock-grid">
                <div className="inventory-catalog-supplier-row inventory-dock-field--wide">
                  <label className="field-label inventory-dock-field">
                    <span>Supplier lane</span>
                    <select name="supplier" className="toolbar-select" value={formData.supplier} onChange={onChange}>
                      <option value="">Select supplier lane</option>
                      {supplierNames.map((supplierName) => (
                        <option key={supplierName} value={supplierName}>
                          {supplierName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="inventory-catalog-policy-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onOpenSupplierStudio?.(selectedSupplier)}
                    >
                      {selectedSupplier ? "Open Supplier Record" : "Create Supplier"}
                    </button>
                  </div>
                </div>

                <label className="field-label inventory-dock-field">
                  <span>Shelf location</span>
                  <input
                    name="shelfLocation"
                    className="input"
                    placeholder="Aisle / bay / cooler / backroom"
                    value={formData.shelfLocation}
                    onChange={onChange}
                  />
                </label>

                <label className="field-label inventory-dock-field inventory-dock-field--wide">
                  <span>Receiving notes</span>
                  <textarea
                    name="receivingNotes"
                    className="input textarea"
                    rows="4"
                    placeholder="Handling notes, temperature requirements, packaging checks, or receiving instructions"
                    value={formData.receivingNotes}
                    onChange={onChange}
                  />
                </label>
              </div>
            </section>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={loading || submitDisabled}>
                {loading ? "Saving..." : editingId ? "Save Product Changes" : "Publish Inventory Record"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onReset} disabled={resetDisabled}>
                {resetLabel}
              </button>
            </div>
          </form>
        </div>

        <aside className="inventory-catalog-side">
          <section className="inventory-catalog-block inventory-catalog-block--side">
            <div className="inventory-dock-section-head">
              <div>
                <span>Publish controls</span>
                <strong>Catalog governance and readiness</strong>
              </div>
              <small>Use this checklist to make sure the item can move cleanly across checkout, inventory, and replenishment.</small>
            </div>

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
          </section>

          <section className="inventory-catalog-block inventory-catalog-block--side">
            <div className="inventory-dock-section-head">
              <div>
                <span>Operational impact</span>
                <strong>What this record will drive</strong>
              </div>
              <small>Live calculations from the staged values in this form.</small>
            </div>

            <div className="inventory-catalog-side-grid">
              {operationalSignals.map((item) => (
                <article key={item.label} className="inventory-catalog-side-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.note}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="inventory-catalog-block inventory-catalog-block--side">
            <div className="inventory-dock-section-head">
              <div>
                <span>Supplier lane policy</span>
                <strong>{selectedSupplier?.name || "Select a supplier lane"}</strong>
              </div>
              <small>
                {selectedSupplier
                  ? "Live procurement and receiving policy from the supplier directory."
                  : "Choose a real supplier lane so the item inherits the correct procurement context."}
              </small>
            </div>

            {selectedSupplier ? (
              <div className="inventory-catalog-policy-grid">
                {supplierSignals.map((item) => (
                  <article key={item.label} className="inventory-catalog-side-card">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.note}</small>
                  </article>
                ))}
              </div>
            ) : (
              <div className="inventory-command-note inventory-command-note--support">
                Products should be tied to a real supplier record before they become part of the live replenishment and
                receiving workflow.
              </div>
            )}

            <div className="inventory-catalog-policy-actions">
              <button type="button" className="btn btn-secondary" onClick={() => onOpenSupplierStudio?.(selectedSupplier)}>
                {selectedSupplier ? "Open Supplier Studio" : "Create Supplier Lane"}
              </button>
            </div>
          </section>

          {operationsRail ? <div className="inventory-command-note inventory-command-note--support">{operationsRail}</div> : null}
        </aside>
      </div>
    </div>
  );
}

export default CommandDockPanel;
