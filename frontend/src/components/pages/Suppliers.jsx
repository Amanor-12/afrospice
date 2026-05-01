import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  FaBoxArchive as FiPackage,
  FaChartLine as FiActivity,
  FaMagnifyingGlass as FiSearch,
  FaPlus as FiPlus,
  FaShieldHalved as FiShield,
  FaTruckFast as FiTruck,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import { LIVE_PAGE_POLL_INTERVAL_MS } from "./pageRuntime";
import SoftPagination from "./shared/SoftPagination";
import { ANALYTICAL_BLUE_ACCENT } from "./shared/chartTheme";
import { getIdentityInitials, getIdentityTone } from "./shared/identityAvatar";
import {
  firstArrayFrom,
  firstNumberFrom,
  formatMoney,
  formatPercent,
  getResponseData,
  toArray,
  toObject,
} from "./shared/dataHelpers";
import WorkspaceBannerStack from "./shared/WorkspaceBannerStack";
import WorkspaceDataStatus from "./shared/WorkspaceDataStatus";

const DIRECTORY_PAGE_SIZE = 8;

function sortSuppliers(items = []) {
  return [...items].sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || "")));
}

function supplierStatusTone(supplier) {
  return supplier?.isActive ? "success" : "danger";
}

function percentageTone(value) {
  const numeric = Number(value || 0);
  if (numeric >= 80) return "success";
  if (numeric >= 50) return "warning";
  return "danger";
}

function signalTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (
    normalized.includes("inactive") ||
    normalized.includes("critical") ||
    normalized.includes("breach") ||
    normalized.includes("failed")
  ) {
    return "danger";
  }
  if (
    normalized.includes("good") ||
    normalized.includes("healthy") ||
    normalized.includes("ready") ||
    normalized.includes("active") ||
    normalized.includes("stable")
  ) {
    return "success";
  }
  if (
    normalized.includes("watch") ||
    normalized.includes("review") ||
    normalized.includes("risk") ||
    normalized.includes("delay") ||
    normalized.includes("draft")
  ) {
    return "warning";
  }
  return "neutral";
}

function wrapAxisLabel(value = "", maxLineLength = 18, maxLines = 2) {
  const words = String(value || "")
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) {
    return [""];
  }

  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxLineLength || !currentLine) {
      currentLine = nextLine;
      return;
    }

    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const visibleLines = lines.slice(0, maxLines);
  visibleLines[maxLines - 1] = `${visibleLines[maxLines - 1].replace(/[. ]+$/u, "")}...`;
  return visibleLines;
}

function SupplierAxisTick({ x = 0, y = 0, payload }) {
  const lines = wrapAxisLabel(payload?.value, 18, 2);

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={12} textAnchor="middle" fill="var(--text-tertiary)" fontSize="11" fontWeight="600">
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? 0 : 14}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function Suppliers({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const range = "monthly";
  const [analyticsData, setAnalyticsData] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [directoryPage, setDirectoryPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());

  const currency = settings?.currency || "USD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";
  const assistantFocus = String(location.state?.assistantFocus || "").trim();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [analyticsResponse, suppliersResponse] = await Promise.all([
          API.get(`/reports/suppliers?range=${range}`),
          API.get("/suppliers"),
        ]);
        if (cancelled) return;

        startTransition(() => {
          const analyticsPayload = getResponseData(analyticsResponse) || {};
          const supplierPayload = sortSuppliers(toArray(getResponseData(suppliersResponse)));
          setAnalyticsData(analyticsPayload);
          setSuppliers(supplierPayload);
          setLastUpdated(
            String(
              analyticsPayload?.generatedAt ||
                analyticsPayload?.operationalHealth?.generatedAt ||
                supplierPayload[0]?.updatedAt ||
                new Date().toISOString()
            )
          );
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || "Could not load supplier data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [range, refreshNonce]);

  useEffect(() => {
    const highlightedId = location.state?.highlightSupplierId;
    if (highlightedId) {
      setSelectedSupplierId(String(highlightedId));
      return;
    }

    if (!selectedSupplierId && suppliers.length) {
      setSelectedSupplierId(String(suppliers[0].id));
      return;
    }

    if (selectedSupplierId && !suppliers.some((supplier) => String(supplier.id) === String(selectedSupplierId))) {
      setSelectedSupplierId(suppliers[0] ? String(suppliers[0].id) : null);
    }
  }, [location.state, selectedSupplierId, suppliers]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
      setRefreshNonce((value) => value + 1);
    }, LIVE_PAGE_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setDirectoryPage(1);
  }, [query, suppliers.length, range]);

  useEffect(() => {
    if (!assistantFocus) return;

    const targetId =
      assistantFocus === "suppliers-service"
        ? "suppliers-service"
        : assistantFocus === "suppliers-open-orders"
        ? "suppliers-open-orders"
        : assistantFocus === "suppliers-risk-ladder"
        ? "suppliers-risk-ladder"
        : assistantFocus === "suppliers-directory"
        ? "suppliers-directory"
        : "";

    if (!targetId) return;

    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [assistantFocus, location.key]);

  const summary = useMemo(() => toObject(analyticsData?.summary), [analyticsData]);
  const executiveSummary = useMemo(() => toObject(analyticsData?.executiveSummary), [analyticsData]);
  const topSuppliers = useMemo(() => firstArrayFrom(analyticsData, ["topSuppliers"]).slice(0, 5), [analyticsData]);
  const openOrders = useMemo(() => firstArrayFrom(analyticsData, ["openOrders"]).slice(0, 6), [analyticsData]);
  const exposureRows = useMemo(() => firstArrayFrom(analyticsData, ["suppliers"]).slice(0, 6), [analyticsData]);
  const signals = useMemo(() => firstArrayFrom(analyticsData, ["actionSignals", "watchtower"]).slice(0, 4), [analyticsData]);

  const selectedSupplier = suppliers.find((supplier) => String(supplier.id) === String(selectedSupplierId)) || null;
  const filteredSuppliers = useMemo(() => {
    const term = String(query || "").trim().toLowerCase();
    if (!term) return suppliers;

    return suppliers.filter((supplier) =>
      [supplier?.name, supplier?.contactName, supplier?.email, supplier?.phone, supplier?.notes]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [query, suppliers]);

  const supplierServiceChart = useMemo(
    () =>
      topSuppliers.map((supplier, index) => ({
        label: String(supplier?.supplier || `Supplier ${index + 1}`),
        serviceScore: firstNumberFrom(supplier, ["serviceScore"]),
      })),
    [topSuppliers]
  );

  const summaryCards = [
    {
      label: "Tracked Suppliers",
      value: `${suppliers.length}`,
      note: `${suppliers.filter((supplier) => supplier?.isActive).length} active`,
      icon: FiTruck,
    },
    {
      label: "Weighted Fill Rate",
      value: formatPercent(firstNumberFrom(summary, ["weightedFillRate"])),
      note: `${firstNumberFrom(summary, ["serviceScore"]).toFixed(0)}/100 service`,
      icon: FiActivity,
    },
    {
      label: "Open Commitments",
      value: formatMoney(currency, firstNumberFrom(summary, ["openCommitmentValue"])),
      note: `${openOrders.length} open orders`,
      icon: FiPackage,
    },
    {
      label: "Exposed SKUs",
      value: `${firstNumberFrom(summary, ["exposedSkuCount"])}`,
      note: `${firstNumberFrom(summary, ["atRiskSuppliers"])} suppliers under pressure`,
      icon: FiShield,
    },
  ];

  const directoryTotalPages = Math.max(1, Math.ceil(filteredSuppliers.length / DIRECTORY_PAGE_SIZE));
  const activeDirectoryPage = Math.min(directoryPage, directoryTotalPages);
  const directoryRows = filteredSuppliers.slice(
    (activeDirectoryPage - 1) * DIRECTORY_PAGE_SIZE,
    activeDirectoryPage * DIRECTORY_PAGE_SIZE
  );

  const openInventoryForSupplier = (supplierName, focus = "inventory-directory") => {
    const nextSupplier = String(supplierName || "").trim();
    if (!nextSupplier) return;

    navigate("/pos-dashboard", {
      state: {
        assistantActionLabel:
          focus === "inventory-create-product" ? `Create stock for ${nextSupplier}` : `Inventory linked to ${nextSupplier}`,
        assistantActionNote:
          focus === "inventory-create-product"
            ? `The inventory product form is prefilled with ${nextSupplier} so a new SKU can be added immediately.`
            : `The inventory workspace is filtered to products, movements, and open purchase orders tied to ${nextSupplier}.`,
        prefillInventoryQuery: focus === "inventory-create-product" ? "" : nextSupplier,
        prefillSupplier: nextSupplier,
        inventoryFocus: focus,
      },
    });
  };

  const openSupplierStudio = (supplier = null) => {
    if (supplier?.id) {
      navigate(`/suppliers/${supplier.id}`, {
        state: {
          assistantActionLabel: `Supplier record for ${supplier.name}`,
          assistantActionNote: "Commercial controls, contacts, and lane expectations are maintained in the supplier studio.",
        },
      });
      return;
    }

    navigate("/suppliers/new", {
      state: {
        assistantActionLabel: "Create supplier",
        assistantActionNote: "Supplier creation lives on its own page so the portfolio dashboard stays focused on live procurement visibility.",
      },
    });
  };

  const openSupplierOrderDraft = (supplier = null) => {
    const supplierName = String(supplier?.name || "").trim();
    navigate("/purchase-orders/new", {
      state: {
        assistantActionLabel: supplierName ? `Draft order for ${supplierName}` : "Draft supplier order",
        assistantActionNote:
          "Supplier ordering stays on its own route so inbound commitments, receiving context, and commercial detail stay clean.",
        prefillPurchaseOrderDraft: {
          supplier: supplierName,
          paymentTermsSnapshot: String(supplier?.paymentTerms || "").trim(),
          expectedDate: "",
          note: supplierName ? `Prepared from the supplier dashboard for ${supplierName}.` : "Prepared from the supplier dashboard.",
          contactSnapshot: {
            name: String(supplier?.contactName || "").trim(),
            email: String(supplier?.email || "").trim(),
            phone: String(supplier?.phone || "").trim(),
          },
          items: [],
        },
      },
    });
  };

  const focusSupplier = (supplierId) => {
    const nextId = String(supplierId || "").trim();
    if (!nextId) return;

    setSelectedSupplierId(nextId);
    window.requestAnimationFrame(() => {
      document.getElementById("supplier-selection-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="page-container suppliers-ref-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      <WorkspaceBannerStack error={error} />
      <section className="reference-page-heading suppliers-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Suppliers</span>
          <h1>Suppliers</h1>
          <p>
            {executiveSummary?.headline ||
              "Manage suppliers effectively with cleaner procurement visibility and unified control."}
          </p>
        </div>

        <div className="reference-page-heading-actions">
          <WorkspaceDataStatus
            loading={loading}
            live={!loading && Boolean(lastUpdated)}
            liveIndicatorLabel="Live supplier portfolio"
            timestamp={lastUpdated}
            nowTick={nowTick}
            useRelativeTime
            showPausedBadge
          />
          <button type="button" className="btn btn-primary" onClick={() => openSupplierStudio()}>
            <FiPlus />
            Create Supplier
          </button>
        </div>
      </section>

      <section className="soft-summary-grid soft-summary-grid--four">
        {summaryCards.map((card) => (
          <article key={card.label} className="soft-summary-card">
            <div className="soft-summary-icon">{card.icon ? <card.icon /> : null}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section id="suppliers-risk-ladder" className="soft-panel soft-panel--compact suppliers-signal-board">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Procurement lanes</span>
            <h2>Supplier signals and next actions</h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => document.getElementById("suppliers-service")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Open Insight Board
          </button>
        </header>
        <div className="soft-card-grid soft-card-grid--four">
          <article id="suppliers-open-orders" className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Best service</span>
              <h3>{topSuppliers[0]?.supplier || "No leader yet"}</h3>
              <p className="subtle">
                {topSuppliers.length
                  ? `${firstNumberFrom(topSuppliers[0], ["serviceScore"]).toFixed(1)} service score`
                  : "No service benchmark has been returned yet."}
              </p>
            </div>
            <div className="soft-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => openInventoryForSupplier(topSuppliers[0]?.supplier)}
                disabled={!topSuppliers[0]?.supplier}
              >
                Open Inventory
              </button>
            </div>
          </article>

          <article className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Open commitment</span>
              <h3>{openOrders[0]?.supplier || openOrders[0]?.id || "No open order"}</h3>
              <p className="subtle">
                {openOrders.length
                  ? `${formatMoney(currency, firstNumberFrom(openOrders[0], ["orderValue", "value"]))} still moving`
                  : "The open purchase queue is clear right now."}
              </p>
            </div>
            <div className="soft-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() =>
                  openSupplierOrderDraft(
                    suppliers.find(
                      (supplier) =>
                        String(supplier?.name || "").trim().toLowerCase() ===
                        String(openOrders[0]?.supplier || "").trim().toLowerCase()
                    ) || { name: openOrders[0]?.supplier || "" }
                  )
                }
                disabled={!openOrders[0]?.supplier && !openOrders[0]?.id}
              >
                Draft Review
              </button>
            </div>
          </article>

          <article className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Exposure</span>
              <h3>{exposureRows[0]?.supplier || exposureRows[0]?.name || "No risk signal"}</h3>
              <p className="subtle">
                {exposureRows.length
                  ? `${firstNumberFrom(exposureRows[0], ["exposedSkuCount"])} exposed SKUs`
                  : "No exposed supplier line is active right now."}
              </p>
            </div>
            <div className="soft-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => openInventoryForSupplier(exposureRows[0]?.supplier || exposureRows[0]?.name)}
                disabled={!exposureRows[0]?.supplier && !exposureRows[0]?.name}
              >
                See Stock
              </button>
            </div>
          </article>

          <article className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Watch note</span>
              <h3>{signals[0]?.title || signals[0]?.label || "No live signal"}</h3>
              <p className="subtle">
                {signals[0]?.summary || signals[0]?.message || signals[0]?.note || "No active supplier watch item is visible right now."}
              </p>
            </div>
            <div className="soft-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => openSupplierStudio(selectedSupplier)}
                disabled={!selectedSupplier}
              >
                Open Record
              </button>
            </div>
          </article>
        </div>
      </section>

      <section id="suppliers-directory" className="soft-panel soft-table-card suppliers-directory-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Supplier List</span>
              <h2>Supplier directory</h2>
            </div>
            <span className="users-directory-count">{filteredSuppliers.length} suppliers</span>
          </header>

          <div className="soft-table-toolbar soft-table-toolbar--filters">
            <div className="reference-inline-search">
              <FiSearch />
              <input
                className="input soft-table-search"
                type="text"
                placeholder="Search suppliers, contacts, email, phone, or notes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {query ? (
              <button type="button" className="btn btn-secondary" onClick={() => setQuery("")}>
                Clear
              </button>
            ) : null}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Service</th>
                  <th>Open Orders</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {directoryRows.length ? (
                  directoryRows.map((supplier) => {
                    const serviceEntry =
                      topSuppliers.find(
                        (item) =>
                          String(item?.supplier || "").trim().toLowerCase() ===
                          String(supplier?.name || "").trim().toLowerCase()
                      ) ||
                      exposureRows.find(
                        (item) =>
                          String(item?.supplier || item?.name || "").trim().toLowerCase() ===
                          String(supplier?.name || "").trim().toLowerCase()
                      );
                    const isSelected = String(selectedSupplierId) === String(supplier.id);
                    const openOrderCount = openOrders.filter(
                      (item) =>
                        String(item?.supplier || "").trim().toLowerCase() ===
                        String(supplier?.name || "").trim().toLowerCase()
                    ).length;

                    return (
                    <tr key={supplier.id} className={isSelected ? "suppliers-directory-row is-selected" : "suppliers-directory-row"}>
                      <td>
                        <div className="reference-name-cell">
                          <span
                            className="reference-avatar reference-avatar--supplier"
                            data-tone={getIdentityTone(supplier?.name, "violet")}
                          >
                            {getIdentityInitials(supplier?.name, "SU")}
                          </span>
                          <div>
                            <strong>{supplier?.name || "Unnamed supplier"}</strong>
                            <div>{supplier?.email || "No email recorded"}</div>
                          </div>
                        </div>
                      </td>
                      <td>{supplier?.contactName || supplier?.phone || "n/a"}</td>
                      <td>
                        {serviceEntry
                          ? `${firstNumberFrom(serviceEntry, ["serviceScore", "fillRate"]).toFixed(1)}${
                              serviceEntry?.serviceScore !== undefined ? "/100" : "%"
                            }`
                          : "n/a"}
                      </td>
                      <td>{openOrderCount || "0"}</td>
                      <td>
                        <span className={`status-pill small ${supplierStatusTone(supplier)}`}>
                          {supplier?.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div className="soft-table-actions">
                          <button
                            type="button"
                            className={`btn btn-secondary btn-compact suppliers-directory-select${isSelected ? " is-selected" : ""}`}
                            onClick={() => focusSupplier(supplier.id)}
                            aria-pressed={isSelected}
                          >
                            {isSelected ? "Selected" : "Select"}
                          </button>
                          <button type="button" className="btn btn-primary btn-compact" onClick={() => openSupplierStudio(supplier)}>
                            Studio
                          </button>
                        </div>
                      </td>
                    </tr>
                  )})
                ) : (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No suppliers match the current search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <SoftPagination currentPage={activeDirectoryPage} totalPages={directoryTotalPages} onChange={setDirectoryPage} />
      </section>

      <section className="soft-section-grid soft-section-grid--two suppliers-reference-lower">
        <article id="supplier-selection-panel" className="soft-panel soft-form-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Selected supplier</span>
              <h2>{selectedSupplier?.name || "Choose a supplier from the directory"}</h2>
            </div>
          </header>

          {selectedSupplier ? (
            <div className="soft-key-value-list">
              <div>
                <span>Contact owner</span>
                <strong>{selectedSupplier?.contactName || "Not captured"}</strong>
              </div>
              <div>
                <span>Reachability</span>
                <strong>{selectedSupplier?.email || selectedSupplier?.phone || "No contact method on file"}</strong>
              </div>
              <div>
                <span>Operating status</span>
                <strong>{selectedSupplier?.isActive ? "Active procurement lane" : "Inactive procurement lane"}</strong>
              </div>
              <div>
                <span>Portfolio note</span>
                <strong>{selectedSupplier?.notes || "No supplier note has been recorded yet."}</strong>
              </div>
              <div>
                <span>Next action</span>
                <strong>
                  {selectedSupplier?.isActive
                    ? "Open the supplier studio to maintain contacts and terms, or draft a purchase order from the dedicated procurement route."
                    : "Review this supplier in the studio before returning the lane to active use."}
                </strong>
              </div>
            </div>
          ) : (
            <div className="customer-record-empty">
              <strong>No supplier selected.</strong>
              <p>Choose a supplier from the directory to inspect its current operating posture and route into the right workspace.</p>
            </div>
          )}

          <div className="soft-form-actions">
            <button type="button" className="btn btn-primary" onClick={() => openSupplierStudio(selectedSupplier)} disabled={!selectedSupplier}>
              Open Supplier Studio
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => openSupplierOrderDraft(selectedSupplier)} disabled={!selectedSupplier}>
              Draft Supplier Order
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => openInventoryForSupplier(selectedSupplier?.name)} disabled={!selectedSupplier}>
              Open Inventory
            </button>
          </div>
        </article>

        <article id="suppliers-service" className="soft-panel suppliers-insight-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Service board</span>
              <h3>Supplier execution and exposure</h3>
            </div>
          </header>
          <div className="soft-chart-shell soft-chart-shell--short">
            {loading ? (
              <p className="subtle">Loading suppliers...</p>
            ) : supplierServiceChart.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={supplierServiceChart} margin={{ top: 8, right: 4, bottom: 18, left: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} height={56} tick={<SupplierAxisTick />} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }} formatter={(value) => [Number(value || 0).toFixed(1), "Service score"]} />
                  <Bar dataKey="serviceScore" fill={ANALYTICAL_BLUE_ACCENT} radius={[8, 8, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="subtle">No supplier service chart is available yet.</p>
            )}
          </div>
          <div className="soft-list suppliers-insight-list">
            {openOrders.length ? (
              openOrders.slice(0, 3).map((order, index) => (
                <article key={`${order?.id || "po"}-${index}`} className="soft-list-row">
                  <div>
                    <strong>{order?.supplier || order?.id || "Supplier"}</strong>
                    <small>
                      {order?.status || "Unknown status"} / {formatMoney(currency, firstNumberFrom(order, ["orderValue", "value"]))}
                    </small>
                  </div>
                  <span className={`status-pill small ${signalTone(order?.status)}`}>
                    {firstNumberFrom(order, ["qtyOrdered", "itemsCount"])} units
                  </span>
                </article>
              ))
            ) : null}
            {exposureRows.slice(0, 2).map((supplier, index) => (
              <article key={`${supplier?.supplier || supplier?.name || "supplier"}-${index}`} className="soft-list-row">
                <div>
                  <strong>{supplier?.supplier || supplier?.name || "Supplier"}</strong>
                  <small>{firstNumberFrom(supplier, ["exposedSkuCount"])} exposed SKUs</small>
                </div>
                <span className={`status-pill small ${percentageTone(firstNumberFrom(supplier, ["fillRate"]))}`}>
                  {formatPercent(firstNumberFrom(supplier, ["fillRate"]))}
                </span>
              </article>
            ))}
            {signals.slice(0, 2).map((item, index) => (
              <article key={`${item?.title || item?.label || "signal"}-${index}`} className="soft-list-row">
                <div>
                  <strong>{item?.title || item?.label || "Signal"}</strong>
                  <small>{item?.summary || item?.message || item?.note || "No supporting note returned."}</small>
                </div>
                <span className={`status-pill small ${signalTone(item?.tone || item?.value || "watch")}`}>
                  {item?.tone || item?.value || "watch"}
                </span>
              </article>
            ))}
            {!openOrders.length && !exposureRows.length && !signals.length ? (
              <p className="subtle">No supplier signals are active right now.</p>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}

export default Suppliers;
