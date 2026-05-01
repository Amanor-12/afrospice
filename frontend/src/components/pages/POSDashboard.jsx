import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaBoxArchive as FiPackage,
  FaChartLine as FiActivity,
  FaDollarSign as FiDollarSign,
  FaTriangleExclamation as FiAlertTriangle,
} from "react-icons/fa6";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import CommandDockPanel from "./inventory/CommandDockPanel";
import InventoryDirectoryPanel from "./inventory/InventoryDirectoryPanel";
import ReorderPlannerPanel from "./inventory/ReorderPlannerPanel";
import {
  clamp,
  emptyForm,
  escapeCsv,
  formatMoney,
  formatDateTime,
  formatRelativeTime,
  getMovementLabel,
  makeSkuFromName,
  normalizeCode,
  normalizeCycleCountsResponse,
  normalizeMovementsResponse,
  normalizeProductsResponse,
  normalizePurchaseOrdersResponse,
  sanitizeText,
} from "./inventory/helpers";
import { getResponseData, toArray } from "./shared/dataHelpers";
import OperationsRail from "./inventory/OperationsRail";
import ActionModal from "./shared/ActionModal";
import WorkspaceBannerStack from "./shared/WorkspaceBannerStack";
import WorkspaceDataStatus from "./shared/WorkspaceDataStatus";

const INVENTORY_DIRECTORY_PAGE_SIZE = 10;

function buildHeroCardStyle(item = {}) {
  return {
    "--hero-card-accent": item.accent || "#60a5fa",
    "--hero-card-accent-strong": item.accentStrong || item.accent || "#2563eb",
    "--hero-card-glow": item.glow || "rgba(59, 130, 246, 0.16)",
    "--hero-card-shadow": item.shadow || "rgba(37, 99, 235, 0.2)",
  };
}

function InventoryLaneCard({ item, active = false, onClick }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className={`workspace-lane-card inventory-lane-card${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      style={buildHeroCardStyle(item)}
    >
      <span className="workspace-lane-card-head">
        <span className="workspace-lane-card-icon">{Icon ? <Icon /> : null}</span>
      </span>

      <span className="workspace-lane-card-copy">
        <strong>{item.title}</strong>
        <span className="subtle">{item.note}</span>
      </span>

      <span className="workspace-lane-card-footer">
        <span className="workspace-lane-card-cta">{item.actionLabel}</span>
      </span>
    </button>
  );
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildProductSignals(products = [], movements = [], lowStockThreshold = 10) {
  const movementMap = new Map();
  const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const movement of movements) {
    const productId = toInteger(movement?.productId);
    if (!productId) continue;

    const current = movementMap.get(productId) || {
      recentUnitsSold: 0,
      lastSoldAt: null,
    };
    const createdAt = movement?.createdAt || null;
    const createdAtTime = new Date(createdAt || 0).getTime();

    if (
      ["sale", "sale_capture"].includes(String(movement?.movementType || "")) &&
      toNumber(movement?.quantityDelta) < 0
    ) {
      current.recentUnitsSold +=
        createdAtTime >= now - recentWindowMs ? Math.abs(toNumber(movement?.quantityDelta)) : 0;

      if (!current.lastSoldAt || createdAtTime > new Date(current.lastSoldAt).getTime()) {
        current.lastSoldAt = createdAt;
      }
    }

    movementMap.set(productId, current);
  }

  return [...products]
    .map((product) => {
      const stock = toInteger(product?.stock);
      const price = toNumber(product?.price);
      const unitCost = toNumber(product?.unitCost);
      const reorderPoint = Math.max(0, toInteger(product?.reorderPoint, lowStockThreshold));
      const parLevel = Math.max(reorderPoint || 0, toInteger(product?.parLevel, Math.max(lowStockThreshold * 2, 12)));
      const criticalThreshold = Math.max(3, Math.round((reorderPoint || lowStockThreshold) / 2));
      const movementSignal = movementMap.get(toInteger(product?.id)) || {
        recentUnitsSold: 0,
        lastSoldAt: null,
      };
      const averageDailyUnits = movementSignal.recentUnitsSold / 14;
      const estimatedDaysCover =
        averageDailyUnits > 0 ? Number((stock / averageDailyUnits).toFixed(1)) : null;
      const daysSinceLastSale = movementSignal.lastSoldAt
        ? Math.floor((now - new Date(movementSignal.lastSoldAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      let lane = "healthy";
      let status = "Healthy";
      if (stock <= criticalThreshold) {
        lane = "critical";
        status = "Critical";
      } else if (stock <= lowStockThreshold || (estimatedDaysCover !== null && estimatedDaysCover <= 7)) {
        lane = "reorder";
        status = "Reorder Soon";
      } else if (stock > lowStockThreshold * 2 && (daysSinceLastSale === null || daysSinceLastSale >= 30)) {
        lane = "dormant";
        status = "Dormant";
      }

      return {
        ...product,
        stock,
        price,
        unitCost,
        reorderPoint,
        parLevel,
        casePack: Math.max(0, toInteger(product?.casePack)),
        unitLabel: sanitizeText(product?.unitLabel || "unit") || "unit",
        shelfLocation: sanitizeText(product?.shelfLocation),
        receivingNotes: sanitizeText(product?.receivingNotes),
        stockValue: stock * (unitCost > 0 ? unitCost : price),
        recentUnitsSold: movementSignal.recentUnitsSold,
        lastSoldAt: movementSignal.lastSoldAt,
        estimatedDaysCover,
        status,
        lane,
      };
    })
    .sort((left, right) => {
      const laneOrder = { critical: 0, reorder: 1, dormant: 2, healthy: 3 };
      const laneDiff = (laneOrder[left?.lane] ?? 99) - (laneOrder[right?.lane] ?? 99);
      if (laneDiff !== 0) return laneDiff;
      return String(left?.name || "").localeCompare(String(right?.name || ""));
    });
}

function getRecommendedQty(product, lowStockThreshold) {
  const stock = toInteger(product?.stock);
  const reorderPoint = Math.max(0, toInteger(product?.reorderPoint, lowStockThreshold));
  const configuredParLevel = Math.max(reorderPoint, toInteger(product?.parLevel));
  const velocityTarget = Math.ceil((toNumber(product?.recentUnitsSold) / 14) * 21);
  const floorTarget = Math.max(configuredParLevel || 0, reorderPoint * 2, lowStockThreshold * 2, velocityTarget, 12);
  const rawRecommendation = Math.max(1, floorTarget - stock);
  const casePack = Math.max(0, toInteger(product?.casePack));

  if (casePack > 1) {
    return Math.ceil(rawRecommendation / casePack) * casePack;
  }

  return rawRecommendation;
}

function downloadText(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function buildProductFormData(product = {}) {
  return {
    name: String(product?.name || ""),
    sku: String(product?.sku || ""),
    barcode: String(product?.barcode || ""),
    imageUrl: String(product?.imageUrl || ""),
    category: String(product?.category || ""),
    supplier: String(product?.supplier || ""),
    taxClass: String(product?.taxClassOverride || product?.taxClass || ""),
    price: String(product?.price ?? ""),
    unitCost: String(product?.unitCost ?? ""),
    stock: String(product?.stock ?? ""),
    unitLabel: String(product?.unitLabel || "unit"),
    casePack: String(product?.casePack ?? ""),
    reorderPoint: String(product?.reorderPoint ?? ""),
    parLevel: String(product?.parLevel ?? ""),
    shelfLocation: String(product?.shelfLocation || ""),
    receivingNotes: String(product?.receivingNotes || ""),
  };
}

function buildCatalogDraftSnapshot(formData = emptyForm, editingId = null) {
  return {
    editingId: editingId ? Number(editingId) : null,
    name: sanitizeText(formData?.name),
    sku: sanitizeText(formData?.sku),
    barcode: sanitizeText(formData?.barcode),
    imageUrl: sanitizeText(formData?.imageUrl),
    category: sanitizeText(formData?.category),
    supplier: sanitizeText(formData?.supplier),
    taxClass: sanitizeText(formData?.taxClass).toUpperCase(),
    price: String(formData?.price ?? "").trim(),
    unitCost: String(formData?.unitCost ?? "").trim(),
    stock: String(formData?.stock ?? "").trim(),
    unitLabel: sanitizeText(formData?.unitLabel || "unit") || "unit",
    casePack: String(formData?.casePack ?? "").trim(),
    reorderPoint: String(formData?.reorderPoint ?? "").trim(),
    parLevel: String(formData?.parLevel ?? "").trim(),
    shelfLocation: sanitizeText(formData?.shelfLocation),
    receivingNotes: sanitizeText(formData?.receivingNotes),
  };
}

function catalogDraftsMatch(leftForm = emptyForm, leftEditingId = null, rightForm = emptyForm, rightEditingId = null) {
  return (
    JSON.stringify(buildCatalogDraftSnapshot(leftForm, leftEditingId)) ===
    JSON.stringify(buildCatalogDraftSnapshot(rightForm, rightEditingId))
  );
}

function POSDashboard({ lowStockThreshold = 10 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const scanRef = useRef(null);
  const insightsRef = useRef(null);
  const prefillSupplier = sanitizeText(location.state?.prefillSupplier);
  const prefillInventoryQuery = String(location.state?.prefillInventoryQuery ?? "");
  const inventoryFocus = sanitizeText(location.state?.inventoryFocus);
  const normalizedInventoryFocus =
    inventoryFocus === "inventory-operations-rail" ? "inventory-operations" : inventoryFocus;
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [movements, setMovements] = useState([]);
  const [cycleCounts, setCycleCounts] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [inventoryLane, setInventoryLane] = useState("all");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [catalogBaseline, setCatalogBaseline] = useState(emptyForm);
  const [catalogBaselineEditingId, setCatalogBaselineEditingId] = useState(null);
  const [scanValue, setScanValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [operationsTab, setOperationsTab] = useState("orders");
  const [cycleCountValues, setCycleCountValues] = useState({});
  const [preferredSupplier, setPreferredSupplier] = useState("");
  const [restockDraft, setRestockDraft] = useState(null);
  const [restockAmount, setRestockAmount] = useState("");
  const [restockError, setRestockError] = useState("");
  const deferredQuery = useDeferredValue(query);
  const inventoryWorkspace = useMemo(() => {
    if (location.pathname.endsWith("/reorder")) return "reorder";
    if (location.pathname.endsWith("/catalog-studio")) return "catalog-studio";
    if (location.pathname.endsWith("/operations")) return "operations";
    return "directory";
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [productsResponse, suppliersResponse, movementsResponse, purchaseOrdersResponse, cycleCountsResponse] =
          await Promise.all([
            API.get("/products"),
            API.get("/suppliers"),
            API.get("/products/movements/recent?limit=120"),
            API.get("/purchase-orders?limit=18"),
            API.get("/cycle-counts?limit=10"),
          ]);

        if (cancelled) return;

        startTransition(() => {
          setProducts(normalizeProductsResponse(getResponseData(productsResponse)));
          setSuppliers(toArray(getResponseData(suppliersResponse)));
          setMovements(normalizeMovementsResponse(getResponseData(movementsResponse)));
          setPurchaseOrders(normalizePurchaseOrdersResponse(getResponseData(purchaseOrdersResponse)));
          setCycleCounts(normalizeCycleCountsResponse(getResponseData(cycleCountsResponse)));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load the inventory workspace.");
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

  useEffect(() => {
    let targetPath = "";
    if (normalizedInventoryFocus === "inventory-directory" && inventoryWorkspace !== "directory") {
      targetPath = "/pos-dashboard";
    } else if (normalizedInventoryFocus === "inventory-reorder-planner" && inventoryWorkspace !== "reorder") {
      targetPath = "/pos-dashboard/reorder";
    } else if (normalizedInventoryFocus === "inventory-create-product" && inventoryWorkspace !== "catalog-studio") {
      targetPath = "/pos-dashboard/catalog-studio";
    } else if (normalizedInventoryFocus === "inventory-operations" && inventoryWorkspace !== "operations") {
      targetPath = "/pos-dashboard/operations";
    }

    if (!targetPath) return;

    navigate(targetPath, {
      replace: true,
      state: location.state || null,
    });
  }, [inventoryWorkspace, location.state, navigate, normalizedInventoryFocus]);

  useEffect(() => {
    if (!normalizedInventoryFocus) return;

    window.requestAnimationFrame(() => {
      document.getElementById(normalizedInventoryFocus)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.key, normalizedInventoryFocus]);

  useEffect(() => {
    if (prefillInventoryQuery) setQuery(prefillInventoryQuery);
    if (prefillSupplier) {
      const nextForm = { ...emptyForm, supplier: prefillSupplier };
      setPreferredSupplier(prefillSupplier);
      setEditingId(null);
      setFormData(nextForm);
      setCatalogBaseline(nextForm);
      setCatalogBaselineEditingId(null);
    }
  }, [location.key, prefillInventoryQuery, prefillSupplier]);

  const productSignals = useMemo(
    () => buildProductSignals(products, movements, toInteger(lowStockThreshold, 10)),
    [products, movements, lowStockThreshold]
  );
  const categories = useMemo(
    () => ["All", ...new Set(productSignals.map((product) => sanitizeText(product?.category || "General")))],
    [productSignals]
  );
  const priorityQueue = useMemo(
    () => productSignals.filter((product) => ["critical", "reorder"].includes(product?.lane)),
    [productSignals]
  );
  const activeCycleCount = useMemo(
    () => cycleCounts.find((count) => String(count?.status || "") === "Open") || null,
    [cycleCounts]
  );

  useEffect(() => {
    if (!activeCycleCount) {
      setCycleCountValues({});
      return;
    }

    const nextValues = {};
    for (const item of toArray(activeCycleCount?.items)) {
      nextValues[item.productId] = item.countedQty ?? item.expectedQty ?? 0;
    }
    setCycleCountValues(nextValues);
  }, [activeCycleCount]);

  const stats = useMemo(() => {
    const totalUnits = productSignals.reduce((sum, product) => sum + toInteger(product?.stock), 0);
    const inventoryValue = productSignals.reduce((sum, product) => sum + toNumber(product?.stockValue), 0);
    const lowStockCount = productSignals.filter((product) => ["critical", "reorder"].includes(product?.lane)).length;
    const criticalCount = productSignals.filter((product) => product?.lane === "critical").length;
    return {
      totalProducts: productSignals.length,
      totalUnits,
      inventoryValue,
      lowStockCount,
      criticalCount,
    };
  }, [productSignals]);

  const dormantProducts = useMemo(
    () => productSignals.filter((product) => product?.lane === "dormant"),
    [productSignals]
  );
  const dormantValue = useMemo(
    () => dormantProducts.reduce((sum, product) => sum + toNumber(product?.stockValue), 0),
    [dormantProducts]
  );
  const selectedDraftProducts = useMemo(
    () => priorityQueue.filter((product) => selectedDraftIds.some((id) => String(id) === String(product.id))),
    [priorityQueue, selectedDraftIds]
  );
  const draftUnits = useMemo(
    () =>
      selectedDraftProducts.reduce(
        (sum, product) => sum + getRecommendedQty(product, toInteger(lowStockThreshold, 10)),
        0
      ),
    [lowStockThreshold, selectedDraftProducts]
  );
  useEffect(() => {
    const availableIds = new Set(priorityQueue.map((product) => String(product.id)));
    setSelectedDraftIds((current) => current.filter((id) => availableIds.has(String(id))));
  }, [priorityQueue]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);

    return productSignals.filter((product) => {
      const matchesLane = inventoryLane === "all" || product?.lane === inventoryLane;
      const matchesCategory = category === "All" || sanitizeText(product?.category) === sanitizeText(category);
      const matchesQuery =
        !normalizedQuery ||
        normalizeCode([product?.name, product?.sku, product?.barcode, product?.supplier, product?.category].join(" ")).includes(normalizedQuery);
      return matchesLane && matchesCategory && matchesQuery;
    });
  }, [category, deferredQuery, inventoryLane, productSignals]);

  const filteredPurchaseOrders = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);
    return purchaseOrders.filter((order) =>
      !normalizedQuery ||
      normalizeCode([order?.id, order?.supplier, order?.status, order?.note].join(" ")).includes(normalizedQuery)
    );
  }, [deferredQuery, purchaseOrders]);

  const filteredMovements = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);
    return movements.filter((movement) =>
      !normalizedQuery ||
      normalizeCode([movement?.productName, movement?.sku, movement?.movementType, movement?.note, movement?.referenceId].join(" ")).includes(normalizedQuery)
    );
  }, [deferredQuery, movements]);

  const filteredCycleCounts = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);
    return cycleCounts.filter((count) =>
      !normalizedQuery ||
      normalizeCode([count?.id, count?.status, count?.note, count?.createdBy].join(" ")).includes(normalizedQuery)
    );
  }, [cycleCounts, deferredQuery]);

  const laneOptions = useMemo(
    () => [
      { key: "all", label: "All", count: productSignals.length },
      { key: "critical", label: "Critical", count: productSignals.filter((product) => product?.lane === "critical").length },
      { key: "reorder", label: "Reorder", count: productSignals.filter((product) => product?.lane === "reorder").length },
      { key: "dormant", label: "Dormant", count: dormantProducts.length },
      { key: "healthy", label: "Healthy", count: productSignals.filter((product) => product?.lane === "healthy").length },
    ],
    [dormantProducts.length, productSignals]
  );
  const laneChartData = useMemo(
    () => laneOptions.filter((item) => item.key !== "all").map((item) => ({ label: item.label, count: item.count })),
    [laneOptions]
  );
  const movementTrend = useMemo(() => {
    const buckets = new Map();
    const recent = [...movements]
      .filter((movement) => movement?.createdAt)
      .slice(0, 36)
      .reverse();

    for (const movement of recent) {
      const date = new Date(movement.createdAt);
      if (Number.isNaN(date.getTime())) continue;
      const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const current = buckets.get(label) || {
        label,
        movementCount: 0,
        netUnits: 0,
      };
      current.movementCount += 1;
      current.netUnits += toNumber(movement?.quantityDelta);
      buckets.set(label, current);
    }

    return [...buckets.values()].slice(-8);
  }, [movements]);

  const purchaseOrderStats = useMemo(() => {
    const openOrders = purchaseOrders.filter((order) =>
      ["Draft", "Sent", "Partially Received"].includes(String(order?.status || ""))
    );
    return {
      open: openOrders.length,
      drafts: purchaseOrders.filter((order) => String(order?.status || "") === "Draft").length,
      inboundUnits: openOrders.reduce((sum, order) => sum + toInteger(order?.openUnits), 0),
    };
  }, [purchaseOrders]);

  const cycleCountStats = useMemo(
    () => ({
      recentVariance: cycleCounts.slice(0, 4).reduce((sum, count) => sum + toNumber(count?.varianceUnits), 0),
    }),
    [cycleCounts]
  );

  const heroScore = clamp(
    100 -
      stats.criticalCount * 10 -
      Math.max(0, stats.lowStockCount - stats.criticalCount) * 4 -
      dormantProducts.length * 2 -
      (activeCycleCount ? 3 : 0),
    38,
    99
  );

  const heroTone = heroScore >= 86 ? "Balanced" : heroScore >= 70 ? "Watchlist" : "Pressure";
  const heroToneClass = heroScore >= 86 ? "success" : heroScore >= 70 ? "warning" : "danger";
  const inventoryBriefs = [
    {
      label: "Inbound queue",
      value: `${purchaseOrderStats.open} open orders`,
      note: `${purchaseOrderStats.inboundUnits} units are still waiting to land.`,
      badge: `${purchaseOrderStats.drafts} live drafts`,
    },
    {
      label: "Cycle count lane",
      value: activeCycleCount ? activeCycleCount.id : "No open count",
      note: activeCycleCount
        ? `${activeCycleCount.linesCount} lines are waiting for verification.`
        : "Start a quick count from the priority queue below.",
      badge: activeCycleCount ? `${activeCycleCount.linesCount} lines` : "Ready",
      tone: activeCycleCount ? "warning" : "success",
    },
    {
      label: "Latest movement",
      value: movements[0]?.productName || "No movement yet",
      note: movements[0]
        ? `${getMovementLabel(movements[0]?.movementType)} ${formatRelativeTime(movements[0]?.createdAt)}`
        : "New stock activity will appear here once the floor changes.",
      badge: movements[0] ? formatDateTime(movements[0]?.createdAt) : "",
    },
  ];

  const liveStatusNote = movements[0]?.createdAt
    ? `Last change ${formatRelativeTime(movements[0]?.createdAt)}`
    : "No recent movement";
  const directoryFiltersActive = Boolean(deferredQuery || category !== "All" || inventoryLane !== "all");

  const openCatalogStudio = (product = null) => {
    if (product) {
      const nextForm = buildProductFormData(product);
      setEditingId(product.id);
      setFormData(nextForm);
      setCatalogBaseline(nextForm);
      setCatalogBaselineEditingId(product.id);
      setPreferredSupplier(String(product?.supplier || ""));
    }

    navigate("/pos-dashboard/catalog-studio");
  };

  const openNewInventoryRecord = () => {
    const nextForm = {
      ...emptyForm,
      supplier: preferredSupplier || "",
    };

    setEditingId(null);
    setScanValue("");
    setFormData(nextForm);
    setCatalogBaseline(nextForm);
    setCatalogBaselineEditingId(null);
    navigate("/pos-dashboard/catalog-studio");
  };

  const openSupplierControl = (supplierName = preferredSupplier || "") => {
    navigate("/suppliers", {
      state: supplierName
        ? {
            assistantActionLabel: `Supplier linked to ${supplierName}`,
            assistantActionNote: "Supplier control is opened with the inventory-linked supplier pinned for review.",
            supplierName,
          }
        : null,
    });
  };

  const openInventoryInsights = () => {
    insightsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    setInventoryPage(1);
  }, [category, deferredQuery, inventoryLane]);

  const inventoryTotalPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / INVENTORY_DIRECTORY_PAGE_SIZE)
  );
  const activeInventoryPage = Math.min(inventoryPage, inventoryTotalPages);
  const pagedInventoryProducts = useMemo(
    () =>
      filteredProducts.slice(
        (activeInventoryPage - 1) * INVENTORY_DIRECTORY_PAGE_SIZE,
        activeInventoryPage * INVENTORY_DIRECTORY_PAGE_SIZE
      ),
    [activeInventoryPage, filteredProducts]
  );

  const resetForm = () => {
    setEditingId(catalogBaselineEditingId);
    setScanValue("");
    setFormData({ ...catalogBaseline });
    setNotice("");
    setError("");
    scanRef.current?.focus();
  };

  const populateForm = (product) => {
    openCatalogStudio(product);
  };

  const onScanSubmit = (event) => {
    event.preventDefault();
    const normalizedScan = normalizeCode(scanValue);
    if (!normalizedScan) return;

    const match = productSignals.find((product) =>
      [product?.barcode, product?.sku, product?.name].map((value) => normalizeCode(value)).includes(normalizedScan)
    );

    if (match) {
      populateForm(match);
      return;
    }

    setEditingId(null);
    setFormData((current) => ({
      ...current,
      barcode: /^\d{6,}$/.test(scanValue) ? scanValue : current.barcode,
      sku: current.sku || (/^\d{6,}$/.test(scanValue) ? "" : String(scanValue || "").toUpperCase()),
      supplier: current.supplier || preferredSupplier,
    }));
    setNotice("No existing SKU matched the scan. The command dock is ready for a new product.");
  };

  const onFormChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => {
      const next = { ...current, [name]: value };
      if (name === "name" && !editingId && !sanitizeText(current.sku)) {
        next.sku = makeSkuFromName(value);
      }
      return next;
    });
  };

  const onImageUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!String(file.type || "").startsWith("image/")) {
      setError("Upload a valid image file for the product photo.");
      return;
    }

    if (Number(file.size || 0) > 2_000_000) {
      setError("Upload a product image smaller than 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextImageUrl = String(reader.result || "").trim();
      if (!nextImageUrl) {
        setError("The selected image could not be read.");
        return;
      }

      setError("");
      setNotice(`${file.name} is ready for this inventory record.`);
      setFormData((current) => ({
        ...current,
        imageUrl: nextImageUrl,
      }));
    };
    reader.onerror = () => {
      setError("The selected image could not be read.");
    };
    reader.readAsDataURL(file);
  };

  const clearImageUpload = () => {
    setFormData((current) => ({
      ...current,
      imageUrl: "",
    }));
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      setError("");
      const payload = {
        name: sanitizeText(formData.name),
        sku: sanitizeText(formData.sku),
        barcode: sanitizeText(formData.barcode),
        imageUrl: sanitizeText(formData.imageUrl),
        category: sanitizeText(formData.category),
        supplier: sanitizeText(formData.supplier),
        taxClass: sanitizeText(formData.taxClass).toUpperCase(),
        price: toNumber(formData.price),
        unitCost: toNumber(formData.unitCost),
        stock: Math.max(0, toInteger(formData.stock)),
        unitLabel: sanitizeText(formData.unitLabel || "unit") || "unit",
        casePack: Math.max(0, toInteger(formData.casePack)),
        reorderPoint: Math.max(0, toInteger(formData.reorderPoint)),
        parLevel: Math.max(0, toInteger(formData.parLevel)),
        shelfLocation: sanitizeText(formData.shelfLocation),
        receivingNotes: sanitizeText(formData.receivingNotes),
      };

      const response = editingId ? await API.put(`/products/${editingId}`, payload) : await API.post("/products", payload);
      const saved = getResponseData(response);
      const nextForm = buildProductFormData(saved);
      setNotice(
        editingId ? `${saved?.name || "Product"} updated successfully.` : `${saved?.name || "Product"} created successfully.`
      );
      setEditingId(saved?.id || null);
      setFormData(nextForm);
      setCatalogBaseline(nextForm);
      setCatalogBaselineEditingId(saved?.id || null);
      setPreferredSupplier(String(saved?.supplier || preferredSupplier || ""));
      setRefreshNonce((current) => current + 1);
    } catch (submitError) {
      setError(submitError?.message || "Could not save the product.");
    } finally {
      setSaving(false);
    }
  };

  const quickRestock = (product) => {
    if (!product) return;

    setRestockDraft(product);
    setRestockAmount(String(getRecommendedQty(product, toInteger(lowStockThreshold, 10))));
    setRestockError("");
  };

  const closeRestockModal = () => {
    if (restockDraft && actionBusy === `restock-${restockDraft.id}`) {
      return;
    }

    setRestockDraft(null);
    setRestockAmount("");
    setRestockError("");
  };

  const confirmRestock = async () => {
    if (!restockDraft) return;

    const amount = Math.max(0, toInteger(restockAmount));
    if (!amount) {
      setRestockError("Enter a restock quantity greater than zero.");
      return;
    }

    try {
      setActionBusy(`restock-${restockDraft.id}`);
      setError("");
      setRestockError("");
      await API.patch(`/products/${restockDraft.id}/restock`, {
        amount,
        note: `Manual restock from inventory workspace for ${restockDraft.name}.`,
      });
      setNotice(`${restockDraft.name} restocked by ${amount} units.`);
      setRestockDraft(null);
      setRestockAmount("");
      setRestockError("");
      setRefreshNonce((current) => current + 1);
    } catch (requestError) {
      setRestockError(requestError?.message || "Could not restock the selected product.");
    } finally {
      setActionBusy("");
    }
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;
    try {
      setSaving(true);
      setError("");
      await API.delete(`/products/${product.id}`);
      if (String(editingId) === String(product.id)) {
        const nextForm = { ...emptyForm, supplier: preferredSupplier };
        setEditingId(null);
        setFormData(nextForm);
        setCatalogBaseline(nextForm);
        setCatalogBaselineEditingId(null);
      }
      setNotice(`${product.name} deleted successfully.`);
      setRefreshNonce((current) => current + 1);
    } catch (deleteError) {
      setError(deleteError?.message || "Could not delete the selected product.");
    } finally {
      setSaving(false);
    }
  };

  const exportDraft = () => {
    const selected = priorityQueue.filter((product) =>
      selectedDraftIds.some((id) => String(id) === String(product.id))
    );
    if (!selected.length) {
      setError("Select one or more reorder lines before exporting the draft.");
      return;
    }

    const rows = [
      ["supplier", "productId", "productName", "sku", "qtyOrdered", "unitCost"].join(","),
      ...selected.map((product) =>
        [
          escapeCsv(product?.supplier || "General Supplier"),
          escapeCsv(product?.id),
          escapeCsv(product?.name),
          escapeCsv(product?.sku),
          escapeCsv(getRecommendedQty(product, toInteger(lowStockThreshold, 10))),
          escapeCsv(product?.unitCost || product?.price || 0),
        ].join(",")
      ),
    ].join("\n");

    downloadText(`inventory-reorder-draft-${new Date().toISOString().slice(0, 10)}.csv`, rows, "text/csv;charset=utf-8");
    setNotice("Reorder draft exported.");
  };

  const createPurchaseOrders = async () => {
    const selected = priorityQueue.filter((product) =>
      selectedDraftIds.some((id) => String(id) === String(product.id))
    );
    if (!selected.length) {
      setError("Select one or more reorder lines before creating purchase orders.");
      return;
    }

    try {
      setActionBusy("create-po");
      setError("");
      await API.post("/purchase-orders/bulk-draft", {
        items: selected.map((product) => ({
          productId: product.id,
          supplier: product.supplier,
          qtyOrdered: getRecommendedQty(product, toInteger(lowStockThreshold, 10)),
          unitCost: product.unitCost || product.price || 0,
        })),
      });
      setNotice("Live purchase-order drafts created from the reorder planner.");
      setSelectedDraftIds([]);
      setOperationsTab("orders");
      setRefreshNonce((current) => current + 1);
    } catch (createError) {
      setError(createError?.message || "Could not create purchase orders.");
    } finally {
      setActionBusy("");
    }
  };

  const markPurchaseOrderStatus = async (orderId, status) => {
    try {
      setActionBusy(`status-${orderId}`);
      setError("");
      await API.patch(`/purchase-orders/${orderId}/status`, { status });
      setNotice(`${orderId} updated to ${status}.`);
      setRefreshNonce((current) => current + 1);
    } catch (statusError) {
      setError(statusError?.message || "Could not update the purchase order.");
    } finally {
      setActionBusy("");
    }
  };

  const receivePurchaseOrder = async (orderId) => {
    try {
      setActionBusy(`receive-${orderId}`);
      setError("");
      await API.post(`/purchase-orders/${orderId}/receive`, {});
      setNotice(`${orderId} received successfully.`);
      setRefreshNonce((current) => current + 1);
    } catch (receiveError) {
      setError(receiveError?.message || "Could not receive the purchase order.");
    } finally {
      setActionBusy("");
    }
  };

  const createCycleCount = async () => {
    const selected = priorityQueue.filter((product) =>
      selectedDraftIds.some((id) => String(id) === String(product.id))
    );
    const source = selected.length ? selected : priorityQueue.slice(0, 5);
    if (!source.length) {
      setError("No inventory lines are available for a quick count.");
      return;
    }

    try {
      setActionBusy("create-count");
      setError("");
      await API.post("/cycle-counts/quick-draft", {
        items: source.map((product) => ({ productId: product.id })),
      });
      setNotice("Live cycle-count draft created from the current pressure lines.");
      setOperationsTab("counts");
      setRefreshNonce((current) => current + 1);
    } catch (createError) {
      setError(createError?.message || "Could not create the cycle count.");
    } finally {
      setActionBusy("");
    }
  };

  const changeCycleCountValue = (productId, value) => {
    setCycleCountValues((current) => ({
      ...current,
      [productId]: value,
    }));
  };

  const completeCycleCount = async (count) => {
    if (!count) return;
    try {
      setActionBusy(`count-${count.id}`);
      setError("");
      await API.post(`/cycle-counts/${count.id}/complete`, {
        items: toArray(count?.items).map((item) => ({
          productId: item.productId,
          countedQty: Math.max(0, toInteger(cycleCountValues[item.productId] ?? item.expectedQty)),
        })),
      });
      setNotice(`${count.id} completed successfully.`);
      setRefreshNonce((current) => current + 1);
    } catch (completeError) {
      setError(completeError?.message || "Could not complete the cycle count.");
    } finally {
      setActionBusy("");
    }
  };

  const catalogDraftDirty = useMemo(
    () => !catalogDraftsMatch(formData, editingId, catalogBaseline, catalogBaselineEditingId),
    [catalogBaseline, catalogBaselineEditingId, editingId, formData]
  );
  const catalogDraftReady =
    Boolean(sanitizeText(formData.name)) &&
    Boolean(sanitizeText(formData.sku)) &&
    Boolean(sanitizeText(formData.category)) &&
    toNumber(formData.price) > 0;
  const catalogBaselineHasContent = useMemo(
    () => !catalogDraftsMatch(catalogBaseline, catalogBaselineEditingId, emptyForm, null),
    [catalogBaseline, catalogBaselineEditingId]
  );
  const catalogResetLabel = catalogBaselineEditingId
    ? "Reset Changes"
    : catalogBaselineHasContent
      ? "Restore Draft"
      : "Clear Draft";
  const inventoryLanes = [
    {
      key: "directory",
      eyebrow: "Directory",
      title: "Open live stock directory",
      note: directoryFiltersActive
        ? `${filteredProducts.length} filtered SKUs are visible in the directory right now.`
        : `${stats.totalProducts} SKUs are live in the stock directory.`,
      actionLabel: "Open Inventory",
      badge: directoryFiltersActive ? `${filteredProducts.length} live` : "Live directory",
      icon: FiPackage,
      accent: "#60a5fa",
      accentStrong: "#2563eb",
      glow: "rgba(59, 130, 246, 0.18)",
      shadow: "rgba(37, 99, 235, 0.24)",
      onClick: () => navigate("/pos-dashboard"),
    },
    {
      key: "reorder",
      eyebrow: "Reorder Planner",
      title: "Draft the next supplier move",
      note: priorityQueue.length
        ? `${priorityQueue.length} priority lines are ready for supplier draft review.`
        : "No urgent replenishment pressure is active right now.",
      actionLabel: "Draft Review",
      badge: priorityQueue.length ? `${priorityQueue.length} priority` : "Balanced",
      icon: FiDollarSign,
      accent: "#4ade80",
      accentStrong: "#16a34a",
      glow: "rgba(34, 197, 94, 0.16)",
      shadow: "rgba(34, 197, 94, 0.22)",
      onClick: () => navigate("/pos-dashboard/reorder"),
    },
    {
      key: "catalog-studio",
      eyebrow: "Catalog Studio",
      title: editingId ? "Live SKU draft in progress" : "Patch live catalog data",
      note: editingId
        ? "A live SKU is open for correction and publish review."
        : "Scan, correct, or create the next SKU in a focused catalog lane.",
      actionLabel: "Open Catalog",
      badge: editingId ? "Draft open" : "Ready",
      icon: FiAlertTriangle,
      accent: "#a78bfa",
      accentStrong: "#7c3aed",
      glow: "rgba(124, 58, 237, 0.16)",
      shadow: "rgba(124, 58, 237, 0.22)",
      onClick: () => navigate("/pos-dashboard/catalog-studio"),
    },
    {
      key: "operations",
      eyebrow: "Operations",
      title: activeCycleCount ? "Count cycle is open" : "Run the operations rail",
      note: activeCycleCount
        ? `${activeCycleCount.id} is waiting for floor verification.`
        : `${purchaseOrderStats.open} purchase orders and ${filteredMovements.length} recent movements are visible.`,
      actionLabel: "Open Record",
      badge: activeCycleCount ? "Count open" : "Ready",
      icon: FiActivity,
      accent: "#38bdf8",
      accentStrong: "#0284c7",
      glow: "rgba(14, 165, 233, 0.16)",
      shadow: "rgba(14, 165, 233, 0.22)",
      onClick: () => {
        setOperationsTab("counts");
        navigate("/pos-dashboard/operations");
      },
    },
  ];
  const inventoryHeadingTitle = priorityQueue.length
    ? `${priorityQueue.length} stock line${priorityQueue.length === 1 ? "" : "s"} need attention`
    : "Stock posture is balanced";
  const inventoryRouteStatus = loading
    ? "Syncing lanes..."
    : `${priorityQueue.length} priority line${priorityQueue.length === 1 ? "" : "s"} active`;
  const inventoryQuickRoutes = [
    {
      key: "directory",
      label: "Open Inventory",
      onClick: () => navigate("/pos-dashboard"),
      primary: inventoryWorkspace === "directory",
    },
    {
      key: "create",
      label: editingId ? "Editing SKU" : "Catalog Studio",
      onClick: editingId ? () => navigate("/pos-dashboard/catalog-studio") : openNewInventoryRecord,
      primary: inventoryWorkspace === "catalog-studio",
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
      primary: inventoryWorkspace !== "directory",
    },
  ];

  return (
    <div className="page-container inventory-page inventory-reference-page">
      <AssistantActionBanner
        label={location.state?.assistantActionLabel || ""}
        note={location.state?.assistantActionNote || ""}
      />
      <WorkspaceBannerStack error={error} notice={notice} />

      <section className="soft-panel soft-panel--compact control-signal-board inventory-lane-board">
        <header className="soft-panel-header">
          <div className="inventory-lane-board-copy">
            <span className="reference-page-kicker">Inventory lanes</span>
            <h1>Inventory</h1>
            <p>
              All inventory lanes in one control surface. {inventoryHeadingTitle}.
            </p>
          </div>

          <button type="button" className="btn btn-secondary btn-compact" onClick={openInventoryInsights}>
            Open inventory insights
          </button>
        </header>

        <div className="route-pill-strip inventory-route-strip">
          <span className="route-pill-status">{inventoryRouteStatus}</span>
          {inventoryQuickRoutes.map((route) => (
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

        <div className="soft-card-grid soft-card-grid--four inventory-lane-grid">
          {inventoryLanes.map((lane) => (
            <InventoryLaneCard
              key={lane.key}
              item={lane}
              active={inventoryWorkspace === lane.key}
              onClick={lane.onClick}
            />
          ))}
        </div>
      </section>

      <section className="inventory-reference-summary">
        <article className={`inventory-reference-stat inventory-reference-stat--${heroToneClass}`}>
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiActivity />
            </div>
          </div>
          <span>Inventory health</span>
          <strong>{heroScore}</strong>
          <small>{heroTone} across the live stock posture.</small>
        </article>
        <article className="inventory-reference-stat">
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiDollarSign />
            </div>
          </div>
          <span>Inventory value</span>
          <strong>{formatMoney(stats.inventoryValue)}</strong>
          <small>{stats.totalUnits} units across the live catalog.</small>
        </article>
        <article className="inventory-reference-stat">
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiAlertTriangle />
            </div>
          </div>
          <span>Low stock items</span>
          <strong>{stats.lowStockCount}</strong>
          <small>{stats.criticalCount} critical lines need priority attention.</small>
        </article>
        <article className="inventory-reference-stat">
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiPackage />
            </div>
          </div>
          <span>Inbound orders</span>
          <strong>{purchaseOrderStats.open}</strong>
          <small>{purchaseOrderStats.inboundUnits} units are still waiting to land.</small>
        </article>
      </section>

      {inventoryWorkspace === "directory" ? (
        <section className="inventory-reference-shell inventory-reference-shell--single">
          <div className="inventory-reference-main">
            <div id="inventory-directory">
              <InventoryDirectoryPanel
                filteredProducts={pagedInventoryProducts}
                filteredProductCount={filteredProducts.length}
                stats={stats}
                query={query}
                category={category}
                categories={categories}
                inventoryLane={inventoryLane}
                laneOptions={laneOptions}
                currentPage={activeInventoryPage}
                totalPages={inventoryTotalPages}
                tableLoading={loading}
                onPageChange={setInventoryPage}
                onCreateProduct={openNewInventoryRecord}
                onQueryChange={setQuery}
                onCategoryChange={setCategory}
                onInventoryLaneChange={setInventoryLane}
                onPopulateForm={openCatalogStudio}
                onQuickRestock={quickRestock}
                onDelete={deleteProduct}
              />
            </div>
          </div>
        </section>
      ) : null}

      {inventoryWorkspace === "reorder" ? (
        <section className="inventory-reference-shell inventory-reference-shell--single">
          <div className="inventory-reference-main">
            <div id="inventory-reorder-planner">
              <ReorderPlannerPanel
                priorityQueue={priorityQueue}
                selectedDraftIds={selectedDraftIds}
                selectedDraftItemsLength={selectedDraftProducts.length}
                draftUnits={draftUnits}
                dormantValue={dormantValue}
                dormantCount={dormantProducts.length}
                actionBusy={actionBusy}
                onSelectAll={() =>
                  setSelectedDraftIds(
                    selectedDraftProducts.length === priorityQueue.length ? [] : priorityQueue.map((product) => product.id)
                  )
                }
                onCreatePurchaseOrders={createPurchaseOrders}
                onExportDraft={exportDraft}
                onToggleDraftSelection={(productId) =>
                  setSelectedDraftIds((current) =>
                    current.some((id) => String(id) === String(productId))
                      ? current.filter((id) => String(id) !== String(productId))
                      : [...current, productId]
                  )
                }
                onPopulateForm={openCatalogStudio}
                onQuickRestock={quickRestock}
                getRecommendedQty={(product) => getRecommendedQty(product, toInteger(lowStockThreshold, 10))}
                liveNow={Date.now()}
              />
            </div>
          </div>
        </section>
      ) : null}

      {inventoryWorkspace === "catalog-studio" ? (
        <section className="inventory-reference-shell inventory-reference-shell--single">
          <div className="inventory-reference-main">
            <div id="inventory-create-product">
              <CommandDockPanel
                editingId={editingId}
                scanRef={scanRef}
                scanValue={scanValue}
                formData={formData}
                suppliers={suppliers}
                loading={saving}
                submitDisabled={saving || !catalogDraftDirty || !catalogDraftReady}
                resetDisabled={saving || !catalogDraftDirty}
                resetLabel={catalogResetLabel}
                onScanValueChange={setScanValue}
                onScanSubmit={onScanSubmit}
                onChange={onFormChange}
                onImageUpload={onImageUpload}
                onRemoveImage={clearImageUpload}
                onSubmit={saveProduct}
                onReset={resetForm}
                onOpenSupplierStudio={openSupplierControl}
                operationsRail={
                  <>
                    Product edits here write directly to the live catalog and feed the receiving, replenishment, and
                    cycle-count workflows.
                  </>
                }
              />
            </div>
          </div>
        </section>
      ) : null}

      {inventoryWorkspace === "operations" ? (
        <div id="inventory-operations" className="inventory-reference-operations">
          <OperationsRail
            actionBusy={actionBusy}
            purchaseOrderStats={purchaseOrderStats}
            activeCycleCount={activeCycleCount}
            cycleCountStats={cycleCountStats}
            operationsTab={operationsTab}
            onSetOperationsTab={setOperationsTab}
            opsLoading={loading}
            purchaseOrders={filteredPurchaseOrders}
            movements={filteredMovements}
            cycleCounts={filteredCycleCounts}
            cycleCountValues={cycleCountValues}
            onBackupExport={() =>
              navigate("/settings", {
                state: {
                  assistantActionLabel: "Controlled backup export",
                  assistantActionNote: "The settings workspace is opened on the backup controls so exports stay audited.",
                  settingsSection: "system",
                  settingsFocus: "settings-backup-controls",
                },
              })
            }
            onPurchaseOrderStatus={markPurchaseOrderStatus}
            onReceiveOrder={receivePurchaseOrder}
            onCreateCycleCount={createCycleCount}
            onCycleCountChange={changeCycleCountValue}
            onCompleteCycleCount={completeCycleCount}
          />
        </div>
      ) : null}

      <section ref={insightsRef} id="inventory-insight-board" className="inventory-reference-insights">
        <article className="dashboard-ref-panel inventory-reference-analytics">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Inventory intelligence</span>
              <h3>Stock mix, movement rhythm, and live pressure</h3>
            </div>
            <WorkspaceDataStatus
              live={Boolean(movements[0]?.createdAt)}
              liveIndicatorLabel="Live stock signals"
              message={liveStatusNote}
              showPausedBadge
            />
          </header>

          <div className="inventory-reference-chart-grid">
            <div className="dashboard-ref-chart-shell dashboard-ref-chart-shell--compact">
              {laneChartData.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={laneChartData}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "14px",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Bar dataKey="count" radius={[10, 10, 0, 0]} fill="var(--chart-accent)" maxBarSize={38} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtle">No stock health distribution is available yet.</p>
              )}
            </div>

            <div className="dashboard-ref-chart-shell dashboard-ref-chart-shell--compact">
              {movementTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={movementTrend}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "14px",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="movementCount"
                      stroke="var(--chart-accent)"
                      fill="var(--chart-accent-soft)"
                      strokeWidth={2.4}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtle">No recent movement rhythm is available yet.</p>
              )}
            </div>
          </div>

          <div className="inventory-reference-brief-row">
            {inventoryBriefs.map((brief) => (
              <article key={brief.label} className="inventory-reference-brief-card">
                <span>{brief.label}</span>
                <strong>{brief.value}</strong>
                <small>{brief.note}</small>
              </article>
            ))}
          </div>
        </article>
      </section>

      <ActionModal
        open={Boolean(restockDraft)}
        title={restockDraft ? `Restock ${restockDraft.name}` : "Restock inventory"}
        description="Update stock in the live directory without leaving the current inventory lane."
        onClose={closeRestockModal}
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={closeRestockModal}
              disabled={Boolean(restockDraft) && actionBusy === `restock-${restockDraft?.id}`}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={confirmRestock}
              disabled={Boolean(restockDraft) && actionBusy === `restock-${restockDraft?.id}`}
            >
              {Boolean(restockDraft) && actionBusy === `restock-${restockDraft?.id}`
                ? "Restocking..."
                : "Confirm Restock"}
            </button>
          </>
        }
      >
        {restockDraft ? (
          <div className="control-modal-stack">
            <div className="control-modal-metrics">
              <article className="control-modal-metric">
                <span>Current stock</span>
                <strong>{toInteger(restockDraft.stock)}</strong>
                <small>Units currently available in the live directory.</small>
              </article>
              <article className="control-modal-metric">
                <span>Recommended qty</span>
                <strong>{getRecommendedQty(restockDraft, toInteger(lowStockThreshold, 10))}</strong>
                <small>Based on the active reorder threshold for this workspace.</small>
              </article>
            </div>

            <label className="control-modal-field">
              <span>Restock amount</span>
              <input
                className="input"
                type="number"
                min="1"
                value={restockAmount}
                onChange={(event) => setRestockAmount(event.target.value)}
              />
            </label>

            {restockError ? (
              <div className="control-modal-alert control-modal-alert--danger">
                <strong>Restock could not be completed</strong>
                <p>{restockError}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </ActionModal>
    </div>
  );
}

export default POSDashboard;
