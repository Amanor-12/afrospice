import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FaArrowTrendUp as FiActivity,
  FaBoxArchive as FiPackage,
  FaChartColumn as FiBarChart2,
  FaShieldHalved as FiShield,
  FaUsers as FiUsers,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import { LIVE_PAGE_POLL_INTERVAL_MS } from "./pageRuntime";
import {
  ANALYTICAL_BLUE_ACCENT,
  ANALYTICAL_BLUE_FAINT,
  ANALYTICAL_BLUE_PALE,
  ANALYTICAL_BLUE_SOFT,
} from "./shared/chartTheme";
import {
  firstArrayFrom,
  firstNumberFrom,
  formatDate,
  formatMoney,
  formatPercent,
  getResponseData,
  toObject,
} from "./shared/dataHelpers";
import { getProductVisual } from "./shared/productVisuals";
import WorkspaceBannerStack from "./shared/WorkspaceBannerStack";
import WorkspaceDataStatus from "./shared/WorkspaceDataStatus";

function dashboardTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (
    normalized.includes("live") ||
    normalized.includes("paid") ||
    normalized.includes("healthy") ||
    normalized.includes("ready")
  ) {
    return "success";
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("watch") ||
    normalized.includes("pressure") ||
    normalized.includes("deferred") ||
    normalized.includes("loading")
  ) {
    return "warning";
  }
  if (
    normalized.includes("risk") ||
    normalized.includes("refund") ||
    normalized.includes("failed") ||
    normalized.includes("critical")
  ) {
    return "danger";
  }
  return "neutral";
}

function getOperationalHealthTone(health = {}) {
  const tone = String(health?.tone || "").trim().toLowerCase();
  if (["success", "warning", "danger", "neutral"].includes(tone)) {
    return tone;
  }

  const status = String(health?.status || "").trim().toLowerCase();
  if (["critical", "delayed"].includes(status)) return "danger";
  if (["warning", "monitor"].includes(status)) return "warning";
  if (["fresh", "healthy", "ready"].includes(status)) return "success";
  return "neutral";
}

function getOperationalHealthLabel(health = {}) {
  const label = String(health?.label || "").trim();
  if (label) return label;

  const status = String(health?.status || "").trim().toLowerCase();
  if (status === "critical") return "Action needed";
  if (status === "delayed") return "Delayed";
  if (status === "warning") return "Needs review";
  if (status === "monitor") return "Monitor";
  if (status === "ready") return "Ready";
  return "Synced";
}

function isOperationalHealthLive(health = {}) {
  const status = String(health?.status || "").trim().toLowerCase();
  return ["fresh", "healthy", "ready", "live"].includes(status);
}

function buildHeroCardStyle(item = {}) {
  return {
    "--hero-card-accent": item.accent || "#60a5fa",
    "--hero-card-accent-strong": item.accentStrong || item.accent || "#2563eb",
    "--hero-card-glow": item.glow || "rgba(59, 130, 246, 0.16)",
    "--hero-card-shadow": item.shadow || "rgba(37, 99, 235, 0.2)",
  };
}

function DashboardActionButton({ item, navigate }) {
  const Icon = item.icon;
  const handleClick = () => {
    if (item.to) {
      navigate(item.to);
      return;
    }
    item.onClick?.();
  };

  return (
    <button type="button" className="workspace-lane-card dashboard-command-card" onClick={handleClick} style={buildHeroCardStyle(item)}>
      <span className="workspace-lane-card-head">
        <span className="workspace-lane-card-icon">{Icon ? <Icon /> : null}</span>
      </span>

      <span className="workspace-lane-card-copy">
        {item.eyebrow ? <span className="workspace-lane-card-kicker">{item.eyebrow}</span> : null}
        <strong>{item.title}</strong>
        {item.note ? <span className="subtle">{item.note}</span> : null}
      </span>

      {item.meta ? (
        <span className="workspace-lane-card-meta">
          <span>{item.metaLabel || "Focus"}</span>
          <strong>{item.meta}</strong>
        </span>
      ) : null}

      <span className="workspace-lane-card-footer">
        <span className="workspace-lane-card-cta">{item.actionLabel}</span>
      </span>
    </button>
  );
}

function DashboardProductRow({ item, currency }) {
  const visual = getProductVisual(item);
  const revenue = firstNumberFrom(item, ["revenue", "value", "sales"]);
  const units = firstNumberFrom(item, ["units", "quantitySold", "orders"]);

  return (
    <article className="dashboard-ref-product-row">
      <div className={`product-thumb product-thumb--${visual.tone}`}>
        <img src={visual.image} alt={visual.alt} />
      </div>
      <div className="dashboard-ref-product-copy">
        <strong>{item?.name || item?.sku || "Product"}</strong>
        <small>{item?.category || item?.supplier || item?.sku || "Live catalog item"}</small>
      </div>
      <div className="dashboard-ref-product-meta">
        <strong>{formatMoney(currency, revenue)}</strong>
        <small>{units ? `${units} units` : "live"}</small>
      </div>
    </article>
  );
}

function Dashboard({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const currency = settings?.currency || "USD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const response = await API.get("/reports/dashboard");
        const data = getResponseData(response) || {};
        if (cancelled) return;

        startTransition(() => {
          setPayload(data);
          setLastUpdated(
            String(data?.operationalHealth?.generatedAt || data?.generatedAt || new Date().toISOString())
          );
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load dashboard data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    loadDashboard();
    const timer = window.setInterval(() => {
      loadDashboard({ silent: true });
    }, LIVE_PAGE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const focus = String(location.state?.assistantFocus || "").trim();
    if (!["dashboard-cash-pulse", "dashboard-demand-drivers", "dashboard-trading-window"].includes(focus)) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(focus)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.key, location.state]);

  const summary = useMemo(() => toObject(payload?.stats || payload?.summary), [payload]);
  const trend = useMemo(() => {
    const revenueTrend = firstArrayFrom(payload, ["revenueTrend", "trend", "dailyTrend"]);
    const statusTrend = firstArrayFrom(payload, ["statusTrend"]);
    const statusMap = new Map(
      statusTrend.map((entry, index) => [
        String(entry?.label || entry?.time || entry?.date || entry?.period || `P-${index + 1}`),
        entry,
      ])
    );
    const source = revenueTrend.length ? revenueTrend : statusTrend;

    return source.map((entry, index) => {
      const label = String(entry?.label || entry?.time || entry?.date || entry?.period || `P-${index + 1}`);
      const statusEntry = statusMap.get(label) || statusTrend[index] || {};

      return {
        label,
        revenue: firstNumberFrom(entry, ["revenue", "capturedRevenue", "totalRevenue", "paidRevenue"]),
        orders: firstNumberFrom(statusEntry, ["orders", "count", "orderCount", "totalOrders", "paidOrders"]),
      };
    });
  }, [payload]);
  const topProducts = useMemo(() => {
    const direct = firstArrayFrom(payload, ["topProducts"]);
    const fallback = Array.isArray(payload?.productPerformance?.topProducts)
      ? payload.productPerformance.topProducts
      : [];
    return (direct.length ? direct : fallback).slice(0, 6);
  }, [payload]);
  const lowStock = useMemo(
    () => firstArrayFrom(payload, ["lowStock", "reorderNow", "inventoryAlerts"]).slice(0, 8),
    [payload]
  );
  const recentSales = useMemo(() => firstArrayFrom(payload, ["recentSales", "sales"]).slice(0, 8), [payload]);
  const briefing = useMemo(() => toObject(payload?.dailyBriefing), [payload]);
  const whatChanged = useMemo(() => firstArrayFrom(payload, ["whatChanged"]).slice(0, 5), [payload]);
  const recommendations = useMemo(
    () => firstArrayFrom(payload, ["recommendations", "smartAlerts", "actionSignals"]).slice(0, 5),
    [payload]
  );
  const mlForecast = useMemo(() => toObject(payload?.mlForecast), [payload]);
  const mlPortfolioSummary = useMemo(() => toObject(mlForecast?.portfolioSummary), [mlForecast]);
  const mlFoundation = useMemo(() => toObject(mlForecast?.dataFoundation), [mlForecast]);
  const staffingIntelligence = useMemo(() => toObject(payload?.staffingIntelligence), [payload]);
  const mlPeriods = useMemo(() => firstArrayFrom(mlForecast, ["periods"]).slice(0, 6), [mlForecast]);
  const mlQualityWarnings = useMemo(
    () => firstArrayFrom(mlFoundation, ["qualityWarnings"]).slice(0, 3),
    [mlFoundation]
  );
  const operationalHealth = useMemo(() => toObject(payload?.operationalHealth), [payload]);

  const revenue = firstNumberFrom(summary, ["capturedRevenue", "revenue", "totalRevenue"]);
  const orderCount = firstNumberFrom(summary, ["totalOrders", "orders", "orderCount", "paidOrders"]);
  const averageOrderValue = firstNumberFrom(summary, ["averageOrderValue", "avgOrderValue", "aov"]);
  const paidRate = firstNumberFrom(summary, ["paidRate", "collectionRate"]);
  const pendingOrders = firstNumberFrom(summary, ["pendingOrders"]);
  const pendingRevenue = firstNumberFrom(summary, ["pendingRevenue"]);
  const declinedRevenue = firstNumberFrom(summary, ["declinedRevenue"]);
  const protectedRevenue = firstNumberFrom(mlPortfolioSummary, ["protectedRevenue"]);
  const prioritySpend = firstNumberFrom(mlPortfolioSummary, ["highPriorityOrderSpend"]);
  const deferredSkuCount = firstNumberFrom(mlPortfolioSummary, ["deferredSkuCount"]);
  const pendingApprovals = firstNumberFrom(staffingIntelligence, ["pendingApprovals"]);
  const readinessScore = firstNumberFrom(staffingIntelligence, ["readinessScore"]);
  const unsettledExposure = pendingRevenue + declinedRevenue;

  const projectionSeries = useMemo(
    () =>
      mlPeriods.map((entry, index) => ({
        label: String(entry?.label || `F-${index + 1}`),
        projectedRevenue: firstNumberFrom(entry, ["projectedRevenue"]),
        projectedRevenueLower: firstNumberFrom(entry, ["projectedRevenueLower"]),
        projectedRevenueUpper: firstNumberFrom(entry, ["projectedRevenueUpper"]),
      })),
    [mlPeriods]
  );

  const decisionQueue = recommendations.length ? recommendations : whatChanged;
  const leadLowStock = lowStock[0] || null;
  const operationalTone = getOperationalHealthTone(operationalHealth);
  const operationalLabel = getOperationalHealthLabel(operationalHealth);
  const operationalMessage = String(operationalHealth?.message || "").trim();

  const commandDeckItems = [
    {
      key: "cash-exposure",
      eyebrow: "Cash control",
      title: "Review cash exposure",
      note: unsettledExposure > 0
        ? `${pendingOrders} unsettled order${pendingOrders === 1 ? "" : "s"} are holding ${formatMoney(
            currency,
            unsettledExposure
          )} outside captured revenue.`
        : "No unsettled order exposure is currently sitting outside captured revenue.",
      metaLabel: "Control point",
      meta: unsettledExposure > 0 ? "Orders ledger" : "Cash posture stable",
      actionLabel: "Open orders",
      icon: FiShield,
      accent: "#fb7185",
      accentStrong: "#f43f5e",
      glow: "rgba(244, 63, 94, 0.18)",
      shadow: "rgba(244, 63, 94, 0.24)",
      onClick: () =>
        navigate("/orders", {
          state: {
            assistantActionLabel: "Cash exposure board",
            assistantActionNote: "Review unsettled orders, payment posture, and refund pressure from the owner ledger.",
            ordersFocus: "orders-ledger",
          },
        }),
    },
    {
      key: "inventory",
      eyebrow: "Stock control",
      title: "Resolve restock pressure",
      note: leadLowStock
        ? `${lowStock.length} live stock line${lowStock.length === 1 ? "" : "s"} are below threshold. ${leadLowStock.name} is the first owner review line.`
        : "No stock lines are currently below the owner threshold.",
      metaLabel: "Priority line",
      meta: leadLowStock?.name || "Inventory balanced",
      actionLabel: "Open replenishment",
      icon: FiPackage,
      accent: "#60a5fa",
      accentStrong: "#2563eb",
      glow: "rgba(59, 130, 246, 0.18)",
      shadow: "rgba(37, 99, 235, 0.24)",
      onClick: () =>
        navigate("/pos-dashboard", {
          state: {
            assistantActionLabel: "Inventory pressure board",
            assistantActionNote: "The replenishment workspace is opened with the reorder queue ready for action.",
            inventoryFocus: "inventory-reorder-planner",
          },
        }),
    },
    {
      key: "workforce",
      eyebrow: "Owner approvals",
      title: "Clear the approval queue",
      note: pendingApprovals
        ? `${pendingApprovals} staff record${pendingApprovals === 1 ? "" : "s"} are waiting on owner approval or activation review.`
        : "No staff records are waiting on owner approval.",
      metaLabel: "Workforce health",
      meta: readinessScore ? `${readinessScore}/100 readiness` : "Owner-controlled",
      actionLabel: "Open users",
      icon: FiUsers,
      accent: "#a78bfa",
      accentStrong: "#7c3aed",
      glow: "rgba(124, 58, 237, 0.16)",
      shadow: "rgba(124, 58, 237, 0.24)",
      onClick: () =>
        navigate("/users", {
          state: {
            assistantActionLabel: "Approval queue",
            assistantActionNote: "Review pending staff records, session posture, and owner-only access controls.",
            assistantFocus: "users-directory",
          },
        }),
    },
    {
      key: "reports",
      eyebrow: "Owner brief",
      title: "Read today's operating brief",
      note:
        String(briefing?.headline || "").trim() ||
        operationalMessage ||
        "Revenue trends, demand signals, and model coverage stay grouped in one reporting surface.",
      metaLabel: "Health",
      meta: operationalLabel,
      actionLabel: "Open reports",
      icon: FiBarChart2,
      accent: "#fbbf24",
      accentStrong: "#f59e0b",
      glow: "rgba(245, 158, 11, 0.16)",
      shadow: "rgba(245, 158, 11, 0.24)",
      to: "/reports",
    },
  ];

  const summaryCards = [
    {
      label: "Revenue Today",
      value: formatMoney(currency, revenue),
      note: `${formatPercent(paidRate)} paid today`,
      icon: FiBarChart2,
    },
    {
      label: "Total Orders",
      value: `${orderCount}`,
      note: `${formatMoney(currency, averageOrderValue)} average order`,
      icon: FiActivity,
    },
    {
      label: "Low Stock Items",
      value: `${lowStock.length}`,
      note: leadLowStock?.name || "Inventory balanced",
      icon: FiPackage,
    },
    {
      label: "Protected Revenue",
      value: formatMoney(currency, protectedRevenue),
      note: `${deferredSkuCount} deferred SKUs under model watch`,
      icon: FiShield,
    },
  ];
  const dashboardRouteStatus = loading
    ? "Syncing data..."
    : lastUpdated
    ? `Updated ${formatDate(lastUpdated)}`
    : "Live routes ready";
  const dashboardQuickRoutes = [
    {
      key: "inventory",
      label: "Open Inventory",
      onClick: () =>
        navigate("/pos-dashboard", {
          state: {
            assistantActionLabel: "Inventory control",
            assistantActionNote: "Open the live stock directory, reorder planner, and catalog correction lanes.",
            inventoryFocus: "inventory-directory",
          },
        }),
    },
    {
      key: "orders",
      label: "Open Orders",
      onClick: () => navigate("/orders"),
    },
    {
      key: "checkout",
      label: "Advanced Checkout",
      onClick: () => navigate("/terminal"),
      primary: true,
    },
  ];

  return (
    <div className="page-container dashboard-page dashboard-reference-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      <WorkspaceBannerStack error={error} />

      <section className="dashboard-ref-hero">
        <div className="dashboard-ref-hero-copy">
          <span className="dashboard-ref-kicker">Executive dashboard</span>
          <h1>
            Welcome back to <span>{settings?.storeName || "AfroSpice"}</span>
          </h1>
          <p>Run your store with a smarter, cleaner control surface.</p>

          <div className="route-pill-strip dashboard-route-strip">
            <span className="route-pill-status">{dashboardRouteStatus}</span>
            {dashboardQuickRoutes.map((route) => (
              <button
                key={route.key}
                type="button"
                className={`route-pill-button${route.primary ? " is-primary" : ""}`}
                onClick={route.onClick}
              >
                {route.label}
              </button>
            ))}
          </div>
          <div className="dashboard-ref-action-board">
            <div className="dashboard-ref-action-row">
              {commandDeckItems.map((item) => (
                <DashboardActionButton key={item.key} item={item} navigate={navigate} />
              ))}
            </div>
          </div>
        </div>

        <aside className="dashboard-ref-spotlight">
          <div className="dashboard-ref-spotlight-copy">
            <span className="dashboard-ref-spotlight-label">Protected revenue</span>
            <strong>{formatMoney(currency, protectedRevenue)}</strong>
            <small>
              {refreshing
                ? "Refreshing live data..."
                : operationalMessage || (lastUpdated ? `Updated ${formatDate(lastUpdated)}` : "Waiting for live data")}
            </small>
          </div>

          <div className="dashboard-ref-mini-chart">
            {trend.length ? (
              <ResponsiveContainer width="100%" height={126}>
                <AreaChart data={trend}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} hide />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "14px",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value) => formatMoney(currency, value)}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={ANALYTICAL_BLUE_ACCENT}
                    fill="var(--chart-accent-soft)"
                    strokeWidth={2.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : null}
          </div>

          <div className="dashboard-ref-spotlight-meta">
            <div>
              <span>Next capital call</span>
              <strong>{formatMoney(currency, prioritySpend)}</strong>
            </div>
            <div>
              <span>Owner brief</span>
              <strong>{briefing?.headline || "Live model watch is active."}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="dashboard-ref-metric-row">
        {summaryCards.map((metric) => (
          <article key={metric.label} className="dashboard-ref-metric-card">
            <div className="reference-stat-head">
              <div className="reference-stat-icon">{metric.icon ? <metric.icon /> : null}</div>
            </div>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-ref-main-grid">
        <article id="dashboard-cash-pulse" className="dashboard-ref-panel dashboard-ref-panel--chart">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Revenue overview</span>
              <h3>Commercial movement through the live window</h3>
            </div>
            <WorkspaceDataStatus
              loading={loading}
              badge={loading || !lastUpdated ? "" : operationalLabel}
              tone={operationalTone}
              live={!loading && isOperationalHealthLive(operationalHealth)}
              liveIndicatorLabel="Live dashboard analytics"
              timestamp={lastUpdated}
              message={operationalMessage}
              showPausedBadge
            />
          </header>

          <div className="dashboard-ref-chart-shell">
            {loading ? (
              <p className="subtle">Loading performance chart...</p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={trend} margin={{ top: 10, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="money"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatMoney(currency, value)}
                  />
                  <YAxis
                    yAxisId="orders"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    domain={[0, (dataMax) => Math.max(4, Math.ceil((Number(dataMax) || 0) * 1.2))]}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "14px",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value, name) => {
                      if (name === "Orders") return [value, name];
                      return [formatMoney(currency, value), name];
                    }}
                  />
                  <Area
                    yAxisId="money"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={ANALYTICAL_BLUE_ACCENT}
                    fill="var(--chart-accent-soft)"
                    strokeWidth={2.8}
                  />
                  <Line
                    yAxisId="orders"
                    type="monotone"
                    dataKey="orders"
                    name="Orders"
                    stroke={ANALYTICAL_BLUE_SOFT}
                    strokeWidth={2.1}
                    strokeDasharray="7 6"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="dashboard-owner-checkpoints" aria-label="Owner revenue checkpoints">
            <article>
              <span>Paid capture</span>
              <strong>{formatPercent(paidRate)}</strong>
              <small>{orderCount} order{orderCount === 1 ? "" : "s"} in the current window</small>
            </article>
            <article>
              <span>Average ticket</span>
              <strong>{formatMoney(currency, averageOrderValue)}</strong>
              <small>Basket quality across completed sales</small>
            </article>
            <article>
              <span>Unsettled exposure</span>
              <strong>{formatMoney(currency, unsettledExposure)}</strong>
              <small>{pendingOrders} order{pendingOrders === 1 ? "" : "s"} need payment or status review</small>
            </article>
            <article>
              <span>Stock pressure</span>
              <strong>{lowStock.length}</strong>
              <small>{leadLowStock?.name || "No SKU is below threshold"}</small>
            </article>
          </div>
        </article>

        <aside className="dashboard-ref-side-stack">
          <article id="dashboard-demand-drivers" className="dashboard-ref-panel dashboard-ref-panel--list">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Top stock</span>
                <h3>Revenue leaders</h3>
              </div>
            </header>

            <div className="dashboard-ref-list">
              {topProducts.length ? (
                topProducts.slice(0, 4).map((product, index) => (
                  <DashboardProductRow
                    key={`${product?.name || product?.sku || "product"}-${index}`}
                    item={product}
                    currency={currency}
                  />
                ))
              ) : (
                <p className="subtle">No product leaderboard is available yet.</p>
              )}
            </div>
          </article>

          <article className="dashboard-ref-panel dashboard-ref-panel--list">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Inventory status</span>
                <h3>Lines needing attention</h3>
              </div>
            </header>

            <div className="dashboard-ref-list">
              {lowStock.length ? (
                lowStock.slice(0, 5).map((item, index) => (
                  <article
                    key={`${item?.sku || item?.name || "risk"}-${index}`}
                    className="dashboard-ref-alert-row"
                  >
                    <div>
                      <strong>{item?.name || item?.sku || "SKU"}</strong>
                      <small>{item?.sku || "No SKU"} / {item?.supplier || "No supplier"}</small>
                    </div>
                    <div className="dashboard-ref-alert-meta">
                      <strong>{item?.stock ?? "n/a"}</strong>
                      <span>left</span>
                    </div>
                  </article>
                ))
              ) : (
                <p className="subtle">No low-stock items are currently active.</p>
              )}
            </div>
          </article>
        </aside>
      </section>

      <section className="dashboard-ref-lower-grid">
        <article id="dashboard-trading-window" className="dashboard-ref-panel dashboard-ref-panel--table">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Recent orders</span>
              <h3>Latest commercial movement</h3>
            </div>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate("/orders")}>
              Open orders
            </button>
          </header>

          <div className="dashboard-ref-table-wrap">
            {recentSales.length ? (
              <table className="table dashboard-ref-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.slice(0, 6).map((sale, index) => (
                    <tr key={`${sale?.id || "sale"}-${index}`}>
                      <td>{sale?.id || "No receipt id"}</td>
                      <td>{formatDate(sale?.date || sale?.createdAt)}</td>
                      <td>{sale?.customer || sale?.cashier || "Walk-in Customer"}</td>
                      <td>
                            <span className={`status-pill small ${dashboardTone(sale?.status || "Unknown")}`}>
                              {sale?.status || "Unknown"}
                            </span>
                      </td>
                      <td>{formatMoney(currency, firstNumberFrom(sale, ["total", "amount"]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="subtle">No recent receipts were returned.</p>
            )}
          </div>
        </article>

        <div className="dashboard-ref-lower-stack">
          <article className="dashboard-ref-panel">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Decision queue</span>
                <h3>What needs action next</h3>
              </div>
            </header>

            <div className="dashboard-ref-list">
              {decisionQueue.length ? (
                decisionQueue.slice(0, 4).map((item, index) => (
                  <article
                    key={`${item?.label || item?.title || "decision"}-${index}`}
                    className="dashboard-ref-decision-row"
                  >
                    <div>
                      <strong>{item?.label || item?.title || "Decision"}</strong>
                      <small>{item?.summary || item?.note || item?.message || "No supporting note returned."}</small>
                    </div>
                    <span className={`status-pill small ${dashboardTone(item?.value || item?.tone || "live")}`}>
                      {item?.value || item?.tone || "live"}
                    </span>
                  </article>
                ))
              ) : (
                <p className="subtle">No narrative changes were returned.</p>
              )}
            </div>
          </article>

          <article className="dashboard-ref-panel">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Forecast studio</span>
                <h3>Forward revenue envelope</h3>
              </div>
            </header>

            <div className="dashboard-ref-chart-shell dashboard-ref-chart-shell--compact">
              {projectionSeries.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={projectionSeries}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => formatMoney(currency, value)} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "14px",
                        color: "var(--text-primary)",
                      }}
                      formatter={(value) => formatMoney(currency, value)}
                    />
                    <Area
                      type="monotone"
                      dataKey="projectedRevenueUpper"
                      stroke={ANALYTICAL_BLUE_PALE}
                      fill={ANALYTICAL_BLUE_FAINT}
                      strokeWidth={1.4}
                    />
                    <Area
                      type="monotone"
                      dataKey="projectedRevenueLower"
                      stroke={ANALYTICAL_BLUE_FAINT}
                      fill={ANALYTICAL_BLUE_FAINT}
                      strokeWidth={1.4}
                    />
                    <Line
                      type="monotone"
                      dataKey="projectedRevenue"
                      stroke={ANALYTICAL_BLUE_ACCENT}
                      strokeWidth={2.8}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtle">No forecast projection is available yet.</p>
              )}
            </div>

            {mlQualityWarnings.length ? (
              <div className="dashboard-ref-note-stack">
                {mlQualityWarnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="dashboard-ref-note">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
