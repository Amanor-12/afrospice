import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FaArrowTrendUp as FiTrendingUp,
  FaChartColumn as FiBarChart2,
  FaDownload as FiDownload,
  FaReceipt as FiReceipt,
  FaShieldHalved as FiShield,
} from "react-icons/fa6";

import API from "../../api/api";
import { LIVE_PAGE_POLL_INTERVAL_MS } from "./pageRuntime";
import TimeRangeSwitch from "./shared/TimeRangeSwitch";
import WorkspaceBannerStack from "./shared/WorkspaceBannerStack";
import WorkspaceDataStatus from "./shared/WorkspaceDataStatus";
import { ANALYTICAL_BLUE_DEEP } from "./shared/chartTheme";
import {
  firstArrayFrom,
  firstNumberFrom,
  formatMoney,
  formatPercent,
  getResponseData,
  toObject,
} from "./shared/dataHelpers";

const CHART_MODES = [
  { id: "revenue", label: "Revenue" },
  { id: "cost", label: "Cost" },
  { id: "profit", label: "Profit" },
  { id: "orders", label: "Orders" },
  { id: "forecast", label: "Forecast" },
];

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric <= 1 ? numeric * 100 : numeric;
}

function getEntryLabel(entry, fallback) {
  return String(entry?.label || entry?.period || entry?.date || entry?.name || fallback);
}

function getDisplayLabel(entry, fallback) {
  return String(entry?.name || entry?.category || entry?.label || fallback);
}

function getForecastRevenue(entry) {
  return firstNumberFrom(entry, ["projectedRevenue", "revenue", "value", "expectedRevenue"]);
}

function getForecastConfidence(entry) {
  return normalizePercent(firstNumberFrom(entry, ["confidence", "confidenceScore", "coverage", "modelCoverage"]));
}

function calculateDelta(current, previous) {
  const currentValue = Number(current);
  const previousValue = Number(previous);

  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return 0;
  if (previousValue === 0) {
    if (currentValue === 0) return 0;
    return currentValue > 0 ? 100 : -100;
  }

  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function formatDeltaLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.1) return "Flat vs previous";
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)}% vs previous`;
}

function getOwnerActionLabel(product = {}, lowStockThreshold = 10) {
  const status = String(product?.status || "").trim();
  const stock = firstNumberFrom(product, ["stock"]);

  if (["Out of Stock", "Awaiting Receipt", "Reorder Soon", "Covered Reorder", "Watch"].includes(status)) {
    return "Review stock";
  }
  if (stock <= lowStockThreshold) return "Restock line";
  if (firstNumberFrom(product, ["profit"]) <= 0) return "Fix margin";
  return "Keep visible";
}

function Reports({ settings }) {
  const navigate = useNavigate();
  const [range, setRange] = useState("monthly");
  const [chartMode, setChartMode] = useState("revenue");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());
  const currency = data?.currency || settings?.currency || "CAD";

  useEffect(() => {
    let cancelled = false;

    const load = async ({ silent = false } = {}) => {
      try {
        if (!silent) setLoading(true);
        const response = await API.get(`/reports?range=${range}`);
        if (cancelled) return;
        startTransition(() => {
          setData(getResponseData(response) || {});
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || "Could not load owner reports.");
      } finally {
        if (!cancelled) setLoading(false);
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
  }, [range]);

  const summary = useMemo(() => toObject(data?.summary), [data]);
  const executiveSummary = useMemo(() => toObject(data?.executiveSummary), [data]);
  const operationalHealth = useMemo(() => toObject(data?.operationalHealth), [data]);
  const mlForecast = useMemo(() => toObject(data?.mlForecast), [data]);
  const actionSignals = useMemo(() => firstArrayFrom(data, ["actionSignals"]).slice(0, 2), [data]);
  const supplierSignals = useMemo(() => firstArrayFrom(mlForecast, ["supplierSignals"]).slice(0, 2), [mlForecast]);
  const topProducts = useMemo(() => firstArrayFrom(data, ["topProducts"]).slice(0, 4), [data]);
  const categoryBreakdown = useMemo(() => {
    const source = firstArrayFrom(data, ["categoryBreakdown"]).slice(0, 4);
    const totalRevenue = firstNumberFrom(summary, ["paidRevenue", "trackedRevenue", "totalRevenue"]);
    return source.map((item) => {
      const value = firstNumberFrom(item, ["value", "revenue", "sales"]);
      return {
        ...item,
        label: getDisplayLabel(item, "Category"),
        value,
        share: totalRevenue > 0 ? (value / totalRevenue) * 100 : 0,
      };
    });
  }, [data, summary]);

  const trendUpdatedAt = useMemo(() => {
    if (data?.generatedAt) return data.generatedAt;
    const source = firstArrayFrom(data, ["trend", "statusTrend"]);
    const latest = [...source]
      .reverse()
      .find((entry) => entry?.updatedAt || entry?.date || entry?.periodEnd || entry?.timestamp);
    return latest?.updatedAt || latest?.date || latest?.periodEnd || latest?.timestamp || "";
  }, [data]);

  const trend = useMemo(() => {
    const revenueTrend = firstArrayFrom(data, ["trend"]);
    const statusTrendSource = firstArrayFrom(data, ["statusTrend"]);
    const statusMap = new Map(statusTrendSource.map((entry, index) => [getEntryLabel(entry, `P-${index + 1}`), entry]));
    const source = revenueTrend.length ? revenueTrend : statusTrendSource;

    return source.map((entry, index) => {
      const label = getEntryLabel(entry, `P-${index + 1}`);
      const statusEntry = statusMap.get(label) || statusTrendSource[index] || {};
      const revenue = firstNumberFrom(entry, ["revenue", "capturedRevenue", "totalRevenue", "paidRevenue"]);
      const profit = firstNumberFrom(entry, ["profit", "grossProfit"]);
      const orders = firstNumberFrom(statusEntry, ["totalOrders", "orders", "count"]) || firstNumberFrom(entry, ["orders", "orderCount", "totalOrders"]);
      const paidRate = normalizePercent(firstNumberFrom(statusEntry, ["paidRate", "collectionRate"]));
      const settledOrders = Math.round((orders * paidRate) / 100);

      return {
        label,
        revenue,
        profit,
        cost: Math.max(revenue - profit, 0),
        orders,
        paidRate,
        settledOrders,
        openOrders: Math.max(orders - settledOrders, 0),
      };
    });
  }, [data]);

  const forecastSeries = useMemo(() => {
    const source = firstArrayFrom(mlForecast, ["periods"]).length
      ? firstArrayFrom(mlForecast, ["periods"])
      : firstArrayFrom(data, ["forecast"]);
    const trendBaseline = trend.slice(-Math.min(trend.length, 3));
    const baselineRevenue = trendBaseline.length
      ? trendBaseline.reduce((sum, item) => sum + firstNumberFrom(item, ["revenue"]), 0) / trendBaseline.length
      : 0;

    return source.slice(0, 6).map((entry, index) => ({
      label: getEntryLabel(entry, `F-${index + 1}`),
      forecastRevenue: getForecastRevenue(entry),
      confidence: getForecastConfidence(entry),
      baselineRevenue,
    }));
  }, [data, mlForecast, trend]);

  const leadProduct = useMemo(() => topProducts[0] || {}, [topProducts]);
  const leadCategory = useMemo(() => categoryBreakdown[0] || {}, [categoryBreakdown]);
  const leadSupplierSignal = useMemo(() => supplierSignals[0] || {}, [supplierSignals]);
  const leadActionSignal = useMemo(() => actionSignals[0] || {}, [actionSignals]);
  const latestTrend = useMemo(() => trend[trend.length - 1] || {}, [trend]);
  const previousTrend = useMemo(() => trend[trend.length - 2] || {}, [trend]);

  const paidCapture = normalizePercent(firstNumberFrom(summary, ["paidRate", "collectionRate"]));
  const unsettledExposure = firstNumberFrom(summary, ["pendingRevenue"]) + firstNumberFrom(summary, ["declinedRevenue"]);
  const lowStockThreshold = Math.max(
    1,
    firstNumberFrom(summary, ["lowStockThreshold"], firstNumberFrom(settings || {}, ["lowStockThreshold"], 10))
  );
  const forecastAverageRevenue = forecastSeries.length
    ? forecastSeries.reduce((sum, item) => sum + firstNumberFrom(item, ["forecastRevenue"]), 0) / forecastSeries.length
    : 0;
  const forecastConfidenceAverage = forecastSeries.length
    ? forecastSeries.reduce((sum, item) => sum + firstNumberFrom(item, ["confidence"]), 0) / forecastSeries.length
    : 0;

  const kpiCards = useMemo(
    () => [
      {
        label: "Captured revenue",
        value: formatMoney(currency, firstNumberFrom(summary, ["paidRevenue", "trackedRevenue", "totalRevenue"])),
        meta: `${firstNumberFrom(summary, ["paidOrders", "orders", "orderCount"])} paid orders closed in this view`,
        delta: formatDeltaLabel(
          calculateDelta(firstNumberFrom(latestTrend, ["revenue"]), firstNumberFrom(previousTrend, ["revenue"]))
        ),
        tone: "blue",
        icon: FiBarChart2,
      },
      {
        label: "Gross profit",
        value: formatMoney(currency, firstNumberFrom(summary, ["profit", "grossProfit"])),
        meta: `${formatPercent(normalizePercent(firstNumberFrom(summary, ["grossMargin"])))} gross margin`,
        delta: formatDeltaLabel(
          calculateDelta(firstNumberFrom(latestTrend, ["profit"]), firstNumberFrom(previousTrend, ["profit"]))
        ),
        tone: "green",
        icon: FiTrendingUp,
      },
      {
        label: "Average ticket",
        value: formatMoney(currency, firstNumberFrom(summary, ["averageOrderValue"])),
        meta: `${formatPercent(paidCapture)} paid capture across the current range`,
        delta: formatDeltaLabel(
          calculateDelta(firstNumberFrom(latestTrend, ["orders"]), firstNumberFrom(previousTrend, ["orders"]))
        ),
        tone: "amber",
        icon: FiReceipt,
      },
      {
        label: "Forecast window",
        value: formatMoney(currency, forecastAverageRevenue),
        meta: `${formatPercent(forecastConfidenceAverage)} confidence on the next modeled range`,
        delta: unsettledExposure > 0 ? "Cash exposure still open" : "No active cash exposure",
        tone: "orange",
        icon: FiShield,
      },
    ],
    [
      currency,
      forecastAverageRevenue,
      forecastConfidenceAverage,
      latestTrend,
      paidCapture,
      previousTrend,
      summary,
      unsettledExposure,
    ]
  );

  const ownerBriefCards = useMemo(
    () => [
      {
        label: "What changed",
        value:
          executiveSummary?.summary ||
          `The store captured ${formatMoney(currency, firstNumberFrom(summary, ["paidRevenue", "trackedRevenue", "totalRevenue"]))} in this reporting range.`,
      },
      {
        label: "What needs watching",
        value: leadSupplierSignal?.supplier
          ? `${leadSupplierSignal.supplier} carries the lead supply risk at ${formatPercent(normalizePercent(firstNumberFrom(leadSupplierSignal, ["maxStockoutProbability"])))} stockout pressure.`
          : leadProduct?.name
            ? `${leadProduct.name} is still the leading line and needs ${firstNumberFrom(leadProduct, ["stock"])} units on-hand reviewed against current demand.`
          : leadCategory?.label
            ? `${leadCategory.label} now holds ${formatPercent(firstNumberFrom(leadCategory, ["share"]))} of revenue concentration.`
            : operationalHealth?.message || "No elevated supply or data-quality watch is active right now.",
      },
      {
        label: "What to do next",
        value: leadActionSignal?.title
          ? `${leadActionSignal.title}: ${leadActionSignal.message || "Use this as the next owner action."}`
          : forecastSeries.length
            ? `The next forecast window averages ${formatMoney(currency, forecastAverageRevenue)} at ${formatPercent(forecastConfidenceAverage)} confidence.`
            : executiveSummary?.nextMove || "No explicit next move was returned by the reporting engine.",
      },
    ],
    [
      currency,
      executiveSummary,
      forecastAverageRevenue,
      forecastConfidenceAverage,
      forecastSeries,
      leadActionSignal,
      leadCategory,
      leadProduct,
      leadSupplierSignal,
      operationalHealth,
      summary,
    ]
  );

  const chartHeadline = useMemo(() => {
    switch (chartMode) {
      case "cost":
        return {
          title: "Cost load across the reporting range",
          note: "Use this to see whether cost pressure is rising faster than revenue quality.",
          chipPrimary: formatMoney(currency, trend.reduce((sum, item) => sum + firstNumberFrom(item, ["cost"]), 0)),
          chipSecondary: "Estimated operating cost tied to recognized sales",
        };
      case "profit":
        return {
          title: "Profit movement across the reporting range",
          note: "This view isolates how much contribution the store kept after cost, period by period.",
          chipPrimary: formatMoney(currency, firstNumberFrom(summary, ["profit", "grossProfit"])),
          chipSecondary: `${formatPercent(normalizePercent(firstNumberFrom(summary, ["grossMargin"])))} gross margin`,
        };
      case "orders":
        return {
          title: "Order quality and settlement posture",
          note: "This shows whether order volume is becoming settled cash or staying unresolved.",
          chipPrimary: `${firstNumberFrom(summary, ["paidOrders", "orders", "orderCount"])} paid orders`,
          chipSecondary: `${firstNumberFrom(summary, ["pendingOrders"]) + firstNumberFrom(summary, ["declinedOrders"])} unsettled orders`,
        };
      case "forecast":
        return {
          title: "Forecast runway for the next demand window",
          note: "Use this to decide how much inventory risk to take into the next modeled period.",
          chipPrimary: formatMoney(currency, forecastAverageRevenue),
          chipSecondary: `${formatPercent(forecastConfidenceAverage)} average confidence`,
        };
      case "revenue":
      default:
        return {
          title: "Revenue movement across the reporting range",
          note: "This is the cleanest view of what the store actually captured in this range.",
          chipPrimary: formatMoney(currency, firstNumberFrom(summary, ["paidRevenue", "trackedRevenue", "totalRevenue"])),
          chipSecondary: `${formatPercent(paidCapture)} paid capture`,
        };
    }
  }, [chartMode, currency, forecastAverageRevenue, forecastConfidenceAverage, paidCapture, summary, trend]);

  const exportCsv = async () => {
    if (exporting) return;

    try {
      setExporting(true);
      setError("");
      const response = await API.get("/reports/export", { responseType: "blob" });
      const blob = new Blob([response.data], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `afrospice-owner-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice("Owner report export downloaded.");
    } catch (exportError) {
      setError(exportError?.message || "Could not export report CSV.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-container reports-ref-page reports-owner-page reports-owner-page--executive reports-owner-page--graph-first">
      <WorkspaceBannerStack error={error} notice={notice} />

      <section className="reports-executive-hero">
        <div className="reports-executive-hero-copy">
          <span className="reference-page-kicker">Owner report desk</span>
          <h1>One graph first, then only the actions that actually matter.</h1>
          <p>
            {executiveSummary?.summary ||
              "This report is intentionally reduced for the owner. You switch the graph between revenue, cost, profit, orders, and forecast instead of reading multiple competing charts."}
          </p>
        </div>
        <div className="reports-executive-hero-actions">
          <TimeRangeSwitch value={range} onChange={setRange} ariaLabel="Reporting range" className="range-switch--toolbar" />
          <WorkspaceDataStatus
            loading={loading}
            live={!loading && Boolean(trendUpdatedAt)}
            liveIndicatorLabel="Backend report snapshot"
            timestamp={trendUpdatedAt}
            nowTick={nowTick}
            useRelativeTime
            waitingMessage="Waiting for backend report data"
            showPausedBadge
          />
          <button type="button" className="route-pill-button is-primary" onClick={exportCsv} disabled={exporting}>
            <FiDownload />
            {exporting ? "Exporting" : "Export report"}
          </button>
        </div>
      </section>

      <section className="reports-executive-kpi-grid">
        {kpiCards.map((card) => (
          <article key={card.label} className="reports-executive-kpi-card">
            <div className={`reports-executive-kpi-icon reports-executive-kpi-icon--${card.tone}`}>
              <card.icon />
            </div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.meta}</small>
            <em>{card.delta}</em>
          </article>
        ))}
      </section>

      <section className="reports-executive-panel reports-executive-panel--graph-first">
        <header className="reports-executive-panel-header reports-executive-panel-header--graph-first">
          <div>
            <span className="reference-page-kicker">Primary owner graph</span>
            <h2>{chartHeadline.title}</h2>
            <p>{chartHeadline.note}</p>
          </div>
          <div className="reports-executive-header-chip">
            <strong>{chartHeadline.chipPrimary}</strong>
            <span>{chartHeadline.chipSecondary}</span>
          </div>
        </header>

        <div className="reports-executive-mode-switch" role="tablist" aria-label="Owner graph mode">
          {CHART_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`route-pill-button ${chartMode === mode.id ? "is-primary" : ""}`}
              aria-pressed={chartMode === mode.id}
              onClick={() => setChartMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="reports-executive-chart-shell reports-executive-chart-shell--hero">
          {loading ? (
            <p className="subtle">Loading owner reporting graph...</p>
          ) : chartMode === "forecast" ? (
            forecastSeries.length ? (
              <ResponsiveContainer width="100%" height={500}>
                <AreaChart data={forecastSeries}>
                  <defs>
                    <linearGradient id="reportsGraphForecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0.04" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => formatMoney(currency, value)} />
                  <YAxis
                    yAxisId="confidence"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${Number(value || 0).toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }}
                    formatter={(value, name) => {
                      if (name === "confidence") return [`${Number(value || 0).toFixed(1)}%`, "Confidence"];
                      if (name === "baselineRevenue") return [formatMoney(currency, value), "Recent baseline"];
                      return [formatMoney(currency, value), "Forecast revenue"];
                    }}
                  />
                  <Area type="monotone" dataKey="forecastRevenue" name="Forecast revenue" stroke="#2563eb" fill="url(#reportsGraphForecastFill)" strokeWidth={3} />
                  <Line type="monotone" dataKey="baselineRevenue" name="Recent baseline" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 6" dot={false} />
                  <Line type="monotone" dataKey="confidence" name="Confidence" yAxisId="confidence" stroke="#f59e0b" strokeWidth={2.4} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="subtle">No forecast series was returned for this range.</p>
            )
          ) : chartMode === "orders" ? (
            trend.length ? (
              <ResponsiveContainer width="100%" height={500}>
                <ComposedChart data={trend}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="orders" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }}
                    formatter={(value, name) => [value, name === "settledOrders" ? "Settled orders" : "Unsettled orders"]}
                  />
                  <Bar yAxisId="orders" dataKey="settledOrders" name="Settled orders" fill={ANALYTICAL_BLUE_DEEP} radius={[12, 12, 0, 0]} />
                  <Bar yAxisId="orders" dataKey="openOrders" name="Unsettled orders" fill="#f59e0b" radius={[12, 12, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="subtle">No order trend returned for this range.</p>
            )
          ) : (
            trend.length ? (
              <ResponsiveContainer width="100%" height={500}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="reportsGraphFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity="0.26" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0.04" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  {chartMode === "revenue" || chartMode === "cost" || chartMode === "profit" ? (
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => formatMoney(currency, value)} />
                  ) : (
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value || 0).toFixed(0)}%`} />
                  )}
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }}
                    formatter={(value) => {
                      if (chartMode === "revenue" || chartMode === "cost" || chartMode === "profit") {
                        return [formatMoney(currency, value), CHART_MODES.find((item) => item.id === chartMode)?.label || "Value"];
                      }
                      return [`${Number(value || 0).toFixed(1)}%`, "Paid capture"];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey={chartMode}
                    name={CHART_MODES.find((item) => item.id === chartMode)?.label || "Value"}
                    stroke={chartMode === "cost" ? "#f59e0b" : chartMode === "profit" ? "#16a34a" : ANALYTICAL_BLUE_DEEP}
                    fill="url(#reportsGraphFill)"
                    strokeWidth={3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="subtle">No report trend returned for this range.</p>
            )
          )}
        </div>
      </section>

      <section className="reports-executive-lower-grid">
        <article className="reports-executive-panel reports-executive-panel--brief">
          <header className="reports-executive-panel-header">
            <div>
              <span className="reference-page-kicker">Owner AI brief</span>
              <h2>{leadActionSignal?.title || executiveSummary?.nextMove || "Protect the strongest revenue line first."}</h2>
              <p>{leadActionSignal?.message || executiveSummary?.whyItMatters || "The report engine did not return a blocking anomaly, so owner attention should stay on margin quality and stock posture."}</p>
            </div>
          </header>

          <div className="reports-executive-brief-grid">
            {ownerBriefCards.map((item) => (
              <article key={item.label} className="reports-executive-brief-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>

          <div className="reports-executive-action-row">
            <button type="button" className="route-pill-button is-primary" onClick={() => navigate("/orders")}>
              Open orders
            </button>
            <button type="button" className="route-pill-button" onClick={() => navigate("/inventory")}>
              Review inventory
            </button>
            <button type="button" className="route-pill-button" onClick={() => navigate("/suppliers")}>
              Review suppliers
            </button>
          </div>
        </article>

        <section className="reports-executive-table-panel reports-executive-table-panel--compact">
          <header className="reports-executive-panel-header">
            <div>
              <span className="reference-page-kicker">Priority products</span>
              <h2>Lines that deserve owner action now</h2>
              <p>These are the most important lines in the current payload based on revenue, margin, and stock posture.</p>
            </div>
          </header>

          <div className="table-wrap reports-owner-table-wrap">
            <table className="table reports-executive-products-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units Sold</th>
                  <th>On Hand</th>
                  <th>Revenue</th>
                  <th>Status</th>
                  <th>Owner Move</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.length ? (
                  topProducts.map((item) => {
                    const status = String(item?.status || "").trim() || "Healthy";
                    const stock = firstNumberFrom(item, ["stock"]);
                    const statusTone =
                      status === "Out of Stock"
                        ? "danger"
                        : ["Awaiting Receipt", "Reorder Soon", "Covered Reorder", "Watch"].includes(status) || stock <= lowStockThreshold
                        ? "warning"
                        : "success";

                    return (
                      <tr key={item?.sku || item?.id || item?.name}>
                        <td>
                          <strong>{item?.name || "Product"}</strong>
                          <div>{item?.supplier || item?.category || "General Supplier"}</div>
                        </td>
                        <td>{firstNumberFrom(item, ["unitsSold"])}</td>
                        <td>{stock}</td>
                        <td>{formatMoney(currency, firstNumberFrom(item, ["revenue"]))}</td>
                        <td>
                          <span className={`status-pill small ${statusTone}`}>{status}</span>
                        </td>
                        <td>
                          <button type="button" className="route-pill-button" onClick={() => navigate("/inventory")}>
                            {getOwnerActionLabel(item, lowStockThreshold)}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No priority-product data is available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

export default Reports;
