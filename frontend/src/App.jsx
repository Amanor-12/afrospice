import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  FaArrowRightFromBracket as FiLogOut,
  FaBars as FiMenu,
  FaBell as FiBell,
  FaBoxArchive as FiBox,
  FaCartShopping as FiShoppingCart,
  FaChartColumn as FiBarChart2,
  FaDisplay as FiMonitor,
  FaGear as FiSettings,
  FaLocationDot as FiMapPin,
  FaMagnifyingGlass as FiSearch,
  FaTableCellsLarge as FiHome,
  FaTruckFast as FiTruck,
  FaUsers as FiUsers,
  FaUserShield as FiUserCheck,
  FaXmark as FiX,
} from "react-icons/fa6";

import API from "./api/api";
import { canAccessRoute, getDefaultRoute, getRouteMeta, getVisibleNavItems } from "./config/access";
import defaultSettings from "./config/defaultSettings";
import useWorkspaceSettings from "./hooks/useWorkspaceSettings";
import {
  clearAuthSession,
  hasAuthSession,
  readStoredUser as readStoredSessionUser,
  writeAuthSession,
} from "./utils/sessionStore";
import lazyWithPreload from "./utils/lazyWithPreload.js";
import GlobalCommandPalette from "./components/GlobalCommandPalette.jsx";
import { getIdentityTone } from "./components/pages/shared/identityAvatar.js";
import "./components/pages/reference-surfaces.css";

const Login = lazyWithPreload(() => import("./components/pages/Login.jsx"));
const Dashboard = lazyWithPreload(() => import("./components/pages/Dashboard.jsx"));
const POSDashboard = lazyWithPreload(() => import("./components/pages/POSDashboard.jsx"));
const POS = lazyWithPreload(() => import("./components/pages/POS.jsx"));
const Users = lazyWithPreload(() => import("./components/pages/Users.jsx"));
const UserManagementDesk = lazyWithPreload(() => import("./components/pages/UserManagementDesk.jsx"));
const Reports = lazyWithPreload(() => import("./components/pages/Reports.jsx"));
const Settings = lazyWithPreload(() => import("./components/pages/Settings.jsx"));
const Orders = lazyWithPreload(() => import("./components/pages/Orders.jsx"));
const RefundDesk = lazyWithPreload(() => import("./components/pages/RefundDesk.jsx"));
const Customers = lazyWithPreload(() => import("./components/pages/Customers.jsx"));
const CustomerProfile = lazyWithPreload(() => import("./components/pages/CustomerProfile.jsx"));
const Suppliers = lazyWithPreload(() => import("./components/pages/Suppliers.jsx"));
const SupplierStudio = lazyWithPreload(() => import("./components/pages/SupplierStudio.jsx"));
const PurchaseOrderBuilder = lazyWithPreload(() => import("./components/pages/PurchaseOrderBuilder.jsx"));
const NotFound = lazyWithPreload(() => import("./components/pages/NotFound.jsx"));
const OwnerAssistantDock = lazyWithPreload(() => import("./components/OwnerAssistantDock.jsx"));

const ROUTE_COMPONENT_REGISTRY = [
  { matches: (path) => path === "/", component: Dashboard },
  { matches: (path) => path.startsWith("/pos-dashboard"), component: POSDashboard },
  { matches: (path) => path.startsWith("/terminal"), component: POS },
  { matches: (path) => path.startsWith("/orders/refunds"), component: RefundDesk },
  { matches: (path) => path.startsWith("/orders"), component: Orders },
  { matches: (path) => path.startsWith("/reports"), component: Reports },
  { matches: (path) => path === "/customers", component: Customers },
  { matches: (path) => path.startsWith("/customers"), component: CustomerProfile },
  { matches: (path) => path === "/suppliers", component: Suppliers },
  { matches: (path) => path.startsWith("/suppliers"), component: SupplierStudio },
  { matches: (path) => path.startsWith("/purchase-orders"), component: PurchaseOrderBuilder },
  { matches: (path) => path.startsWith("/users/staff"), component: UserManagementDesk },
  { matches: (path) => path.startsWith("/users"), component: Users },
  { matches: (path) => path.startsWith("/settings"), component: Settings },
];

function scheduleIdleWork(callback) {
  if (typeof window === "undefined") {
    return () => {};
  }

  if (typeof window.requestIdleCallback === "function") {
    const callbackId = window.requestIdleCallback(callback, { timeout: 1800 });
    return () => window.cancelIdleCallback?.(callbackId);
  }

  const timeoutId = window.setTimeout(callback, 320);
  return () => window.clearTimeout(timeoutId);
}

function preloadRouteComponent(path = "") {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return;
  }

  const match = ROUTE_COMPONENT_REGISTRY.find((entry) => entry.matches(normalizedPath));
  match?.component?.preload?.();
}

const NAV_ICONS = {
  "/": FiHome,
  "/pos-dashboard": FiBox,
  "/terminal": FiMonitor,
  "/orders": FiShoppingCart,
  "/reports": FiBarChart2,
  "/customers": FiUsers,
  "/suppliers": FiTruck,
  "/users": FiUserCheck,
  "/settings": FiSettings,
};

const SIDEBAR_ICON_STYLES = {
  dashboard: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(37, 99, 235, 0.24)",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#ffffff",
  },
  inventory: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(99, 102, 241, 0.24)",
    background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
    color: "#ffffff",
  },
  pos: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(14, 165, 233, 0.24)",
    background: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
    color: "#ffffff",
  },
  orders: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #f59e0b 0%, #fb7185 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(249, 115, 22, 0.24)",
    background: "linear-gradient(135deg, #f59e0b 0%, #fb7185 100%)",
    color: "#ffffff",
  },
  reports: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(99, 102, 241, 0.24)",
    background: "linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)",
    color: "#ffffff",
  },
  customers: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(56, 189, 248, 0.24)",
    background: "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
    color: "#ffffff",
  },
  suppliers: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(249, 115, 22, 0.24)",
    background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
    color: "#ffffff",
  },
  users: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(168, 85, 247, 0.24)",
    background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
    color: "#ffffff",
  },
  settings: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(59, 130, 246, 0.24)",
    background: "linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)",
    color: "#ffffff",
  },
};

const WELCOME_AVATAR_STYLES = {
  violet: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(124, 58, 237, 0.26)",
    background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
    color: "#ffffff",
  },
  purple: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(99, 102, 241, 0.24)",
    background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
    color: "#ffffff",
  },
  blue: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(37, 99, 235, 0.24)",
    background: "linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)",
    color: "#ffffff",
  },
  cyan: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #06b6d4 0%, #38bdf8 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(14, 165, 233, 0.24)",
    background: "linear-gradient(135deg, #06b6d4 0%, #38bdf8 100%)",
    color: "#ffffff",
  },
  pink: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #ec4899 0%, #f97316 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(236, 72, 153, 0.24)",
    background: "linear-gradient(135deg, #ec4899 0%, #f97316 100%)",
    color: "#ffffff",
  },
};

const RECENT_ROUTE_STORAGE_KEY = "afrospice_recent_routes";
function readRecentRoutes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_ROUTE_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRecentRoutes(paths) {
  try {
    localStorage.setItem(RECENT_ROUTE_STORAGE_KEY, JSON.stringify(paths.slice(0, 6)));
  } catch {
    // Keep the shell resilient if storage is blocked.
  }
}

function rememberRoute(path) {
  if (!path || path === "/login") return;
  const next = [path, ...readRecentRoutes().filter((entry) => entry !== path)].slice(0, 6);
  writeRecentRoutes(next);
}

function formatNotificationTimestamp(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function resolveRouteTheme(pathname) {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/pos-dashboard")) return "inventory";
  if (pathname.startsWith("/terminal")) return "pos";
  if (pathname.startsWith("/orders")) return "orders";
  if (pathname.startsWith("/purchase-orders")) return "suppliers";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/customers")) return "customers";
  if (pathname.startsWith("/suppliers")) return "suppliers";
  if (pathname.startsWith("/users")) return "users";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}

function groupNavItems(items = []) {
  const groups = [
    {
      label: "Main",
      paths: ["/", "/pos-dashboard", "/terminal", "/orders"],
    },
    {
      label: "Analytics",
      paths: ["/reports", "/customers", "/suppliers", "/users"],
    },
    {
      label: "Settings",
      paths: ["/settings"],
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      items: items.filter((item) => group.paths.includes(item.path)),
    }))
    .filter((group) => group.items.length);
}

function RouteLoader() {
  return (
    <div className="app-boot-shell">
      <div className="app-boot-mark">AfroSpice</div>
      <p>Loading workspace...</p>
    </div>
  );
}

function WorkspacePageLoader({
  eyebrow = "Preparing view",
  title = "Loading workspace page",
  description = "Hydrating live data, controls, and surface layouts for this route.",
}) {
  return (
    <div className="workspace-page-loader" aria-live="polite" aria-busy="true">
      <div className="workspace-page-loader-hero">
        <div className="workspace-page-loader-copy">
          <span>{eyebrow}</span>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        <div className="workspace-page-loader-actions">
          <span className="workspace-page-loader-pill" />
          <span className="workspace-page-loader-pill workspace-page-loader-pill--wide" />
        </div>
      </div>

      <div className="workspace-page-loader-grid">
        <div className="workspace-page-loader-card workspace-page-loader-card--feature" />
        <div className="workspace-page-loader-card" />
        <div className="workspace-page-loader-card" />
      </div>
    </div>
  );
}

function ProtectedRoute({ loggedIn, sessionReady, userRole, allowedRoles, children }) {
  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!sessionReady) {
    return <div className="app-boot-shell">Loading workspace session...</div>;
  }

  if (allowedRoles?.length && !canAccessRoute(userRole, allowedRoles)) {
    return (
      <div className="app-boot-shell app-boot-shell--denied">
        <div className="app-boot-mark">Owner Access Required</div>
        <p>This AfroSpice workspace is configured for the owner account only.</p>
      </div>
    );
  }

  return children;
}

function LazyWorkspaceRoute({
  component,
  pageKey,
  props = {},
  loadingTitle,
  loadingDescription,
}) {
  const location = useLocation();
  const PageComponent = component;
  const resolvedPageKey = pageKey || location.pathname;

  return (
    <Suspense
      fallback={
        <WorkspacePageLoader title={loadingTitle} description={loadingDescription} />
      }
    >
      <PageComponent key={resolvedPageKey} {...props} />
    </Suspense>
  );
}

function OwnerMenu({ settings, sessionUser, onLogout }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const menuRef = useRef(null);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const displayName = sessionUser?.fullName || settings.managerName || "Workspace User";
  const displayRole = sessionUser?.role || "Owner";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="owner-menu" ref={menuRef}>
      <button
        type="button"
        className="owner-avatar-btn"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="owner-avatar-circle">{initials}</span>
        <span className="owner-avatar-meta">
          <strong>{displayName}</strong>
          <small>{displayRole}</small>
        </span>
      </button>

      {open ? (
        <div className="owner-menu-dropdown">
          <div className="owner-menu-header">
            <div className="owner-menu-avatar">{initials}</div>
            <div>
              <strong>{displayName}</strong>
              <p>{settings.storeName}</p>
            </div>
          </div>

          {getVisibleNavItems(displayRole).slice(1).map((item) => (
            <button
              key={item.path}
              type="button"
              className="owner-menu-item"
              onMouseEnter={() => preloadRouteComponent(item.path)}
              onFocus={() => preloadRouteComponent(item.path)}
              onClick={() => {
                preloadRouteComponent(item.path);
                navigate(item.path);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}

          <button
            type="button"
            className="owner-menu-item danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ForcePinChangeModal({ sessionUser, onUserUpdate, onLogout }) {
  const [form, setForm] = useState({
    currentPin: "",
    nextPin: "",
    confirmPin: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateField = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: String(value || "").replace(/\D/g, "").slice(0, 6),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!/^\d{4,6}$/.test(form.currentPin) || !/^\d{4,6}$/.test(form.nextPin)) {
      setError("Current PIN and new PIN must both use 4-6 digits.");
      return;
    }

    if (form.nextPin !== form.confirmPin) {
      setError("PIN confirmation does not match.");
      return;
    }

    if (form.currentPin === form.nextPin) {
      setError("Choose a new PIN that is different from the temporary PIN.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const res = await API.post("/auth/change-pin", form);
      const nextUser = res?.data?.data?.user || null;
      if (nextUser) {
        onUserUpdate(nextUser);
      }
    } catch (submitError) {
      console.error("Forced PIN change failed:", submitError);
      setError(submitError?.message || submitError?.data?.message || "Failed to change PIN.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="force-pin-modal-backdrop">
      <div className="force-pin-modal">
        <div className="force-pin-modal-copy">
          <p className="eyebrow">Security Update</p>
          <h3>Change Your Temporary PIN</h3>
          <p>
            {sessionUser?.fullName || "This staff account"} must replace the temporary PIN before using the workspace.
          </p>
        </div>

        {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}

        <form className="stack-form" onSubmit={handleSubmit}>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            placeholder="Current temporary PIN"
            value={form.currentPin}
            onChange={(event) => updateField("currentPin", event.target.value)}
          />
          <div className="form-two-col">
            <input
              className="input"
              type="password"
              inputMode="numeric"
              placeholder="New PIN"
              value={form.nextPin}
              onChange={(event) => updateField("nextPin", event.target.value)}
            />
            <input
              className="input"
              type="password"
              inputMode="numeric"
              placeholder="Confirm new PIN"
              value={form.confirmPin}
              onChange={(event) => updateField("confirmPin", event.target.value)}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save New PIN"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onLogout} disabled={saving}>
              Logout
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AppShell({ settings, sessionUser, onLogout, onUserUpdate, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationPayload, setNotificationPayload] = useState({
    generatedAt: "",
    unreadCount: 0,
    items: [],
  });
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsMutating, setNotificationsMutating] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const routeMeta = useMemo(() => getRouteMeta(location.pathname), [location.pathname]);
  const routeTheme = useMemo(() => resolveRouteTheme(location.pathname), [location.pathname]);
  const navItems = useMemo(() => getVisibleNavItems(sessionUser?.role), [sessionUser?.role]);
  const navGroups = useMemo(() => groupNavItems(navItems), [navItems]);
  const notificationRef = useRef(null);
  const notificationAudioRef = useRef(null);
  const notificationBootstrappedRef = useRef(false);
  const previousUnreadCountRef = useRef(0);
  const profileInitials = useMemo(() => {
    const source = String(sessionUser?.fullName || settings.managerName || "AfroSpice")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return source || "AS";
  }, [sessionUser?.fullName, settings.managerName]);
  const sidebarStoreLabel = useMemo(() => {
    const storeName = String(settings.storeName || "Main Branch").trim();
    return storeName.replace(/^AfroSpice\s+/i, "") || storeName;
  }, [settings.storeName]);
  const profileTone = useMemo(
    () => getIdentityTone(sessionUser?.fullName || settings.managerName || settings.storeName || "Store Owner", "blue"),
    [sessionUser?.fullName, settings.managerName, settings.storeName]
  );
  const searchPrompt = useMemo(
    () => `Search ${String(routeMeta.label || "workspace").toLowerCase()}, actions, and tools`,
    [routeMeta.label]
  );
  const notificationsEnabled = useMemo(
    () =>
      Boolean(settings?.notifications) &&
      ["Owner", "Manager", "Cashier", "Inventory Clerk"].includes(String(sessionUser?.role || "")),
    [sessionUser?.role, settings?.notifications]
  );
  const notificationItems = useMemo(
    () => (Array.isArray(notificationPayload?.items) ? notificationPayload.items : []),
    [notificationPayload]
  );
  const unreadNotificationCount = useMemo(
    () =>
      Number(notificationPayload?.unreadCount || 0) ||
      notificationItems.filter((item) => !item?.acknowledged).length,
    [notificationItems, notificationPayload?.unreadCount]
  );

  const playNotificationTone = useCallback(({ force = false } = {}) => {
    if ((!settings?.soundEffects && !force) || typeof window === "undefined") {
      return;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    try {
      const context = notificationAudioRef.current || new AudioContextConstructor();
      notificationAudioRef.current = context;

      if (context.state === "suspended") {
        context.resume().catch(() => {});
      }

      const createTone = (frequency, startOffset, duration, volume) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.0001;

        oscillator.connect(gain);
        gain.connect(context.destination);

        const startAt = context.currentTime + startOffset;
        oscillator.start(startAt);
        gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.stop(startAt + duration + 0.03);
      };

      createTone(880, 0, 0.18, 0.05);
      createTone(1175, 0.11, 0.18, 0.035);
    } catch {
      // Keep the shell resilient if the browser blocks synthesized audio.
    }
  }, [settings?.soundEffects]);

  useEffect(() => {
    const handleNotificationSoundTest = () => {
      playNotificationTone({ force: true });
    };

    window.addEventListener("afrospice:notification-sound:test", handleNotificationSoundTest);
    return () =>
      window.removeEventListener("afrospice:notification-sound:test", handleNotificationSoundTest);
  }, [playNotificationTone]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!notificationOpen) return undefined;

    const handleOutside = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setNotificationOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setNotificationOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [notificationOpen]);

  const fetchNotifications = useCallback(
    async ({ silent = false } = {}) => {
      if (!notificationsEnabled) {
        setNotificationPayload({
          generatedAt: "",
          unreadCount: 0,
          items: [],
        });
        setNotificationError("");
        return;
      }

      if (!silent) {
        setNotificationsLoading(true);
      }

      try {
        const response = await API.get("/reports/notifications");
        const data = response?.data?.data || {};
        setNotificationPayload({
          generatedAt: String(data?.generatedAt || ""),
          unreadCount: Number(data?.unreadCount || 0),
          items: Array.isArray(data?.items) ? data.items : [],
        });
        setNotificationError("");
      } catch (loadError) {
        setNotificationError(loadError?.message || "Could not load workspace notifications.");
      } finally {
        if (!silent) {
          setNotificationsLoading(false);
        }
      }
    },
    [notificationsEnabled]
  );

  const acknowledgeNotifications = useCallback(
    async ({ ids = [], markAll = false, silent = false } = {}) => {
      const normalizedIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
      if (!notificationsEnabled || (!markAll && !normalizedIds.length)) {
        return;
      }

      if (!silent) {
        setNotificationsMutating(true);
      }

      try {
        const response = await API.post("/reports/notifications/acknowledge", {
          ids: normalizedIds,
          markAll,
        });
        const data = response?.data?.data || {};
        setNotificationPayload({
          generatedAt: String(data?.generatedAt || ""),
          unreadCount: Number(data?.unreadCount || 0),
          items: Array.isArray(data?.items) ? data.items : [],
        });
        setNotificationError("");
      } catch (acknowledgeError) {
        setNotificationError(
          acknowledgeError?.message || "Could not acknowledge workspace notifications."
        );
      } finally {
        if (!silent) {
          setNotificationsMutating(false);
        }
      }
    },
    [notificationsEnabled]
  );

  useEffect(() => {
    fetchNotifications();

    if (!notificationsEnabled) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      fetchNotifications({ silent: true });
    }, 45000);

    return () => window.clearInterval(intervalId);
  }, [fetchNotifications, notificationsEnabled]);

  useEffect(() => {
    if (!notificationsEnabled) {
      notificationBootstrappedRef.current = false;
      previousUnreadCountRef.current = 0;
      return;
    }

    if (!notificationBootstrappedRef.current) {
      notificationBootstrappedRef.current = true;
      previousUnreadCountRef.current = unreadNotificationCount;
      return;
    }

    if (settings?.soundEffects && unreadNotificationCount > previousUnreadCountRef.current) {
      playNotificationTone();
    }

    previousUnreadCountRef.current = unreadNotificationCount;
  }, [notificationsEnabled, playNotificationTone, settings?.soundEffects, unreadNotificationCount]);

  useEffect(() => {
    return scheduleIdleWork(() => {
      navItems
        .filter((item) => item.path !== location.pathname)
        .slice(0, 5)
        .forEach((item) => preloadRouteComponent(item.path));

      if (["Owner", "Manager"].includes(String(sessionUser?.role || ""))) {
        OwnerAssistantDock.preload?.();
      }
    });
  }, [location.pathname, navItems, sessionUser?.role]);

  const handleNavigate = useCallback(
    (path) => {
      preloadRouteComponent(path);
      rememberRoute(path);
      setCommandPaletteOpen(false);
      setCommandQuery("");
      setSidebarOpen(false);
      navigate(path);
    },
    [navigate]
  );

  const handleNotificationAction = useCallback(
    async (item) => {
      const path = String(item?.action?.path || "").trim();
      if (!path) {
        setNotificationOpen(false);
        return;
      }

      await acknowledgeNotifications({
        ids: [item?.id],
        silent: true,
      });
      preloadRouteComponent(path);
      rememberRoute(path);
      setNotificationOpen(false);
      navigate(path, {
        state: {
          assistantActionLabel: item?.title || item?.action?.label || "Notification",
          assistantActionNote: item?.action?.note || item?.detail || "",
          assistantFocus: item?.action?.focus || "",
          assistantTs: Date.now(),
        },
      });
    },
    [acknowledgeNotifications, navigate]
  );

  const handleNotificationAcknowledge = useCallback(
    async (item) => {
      await acknowledgeNotifications({
        ids: [item?.id],
      });
    },
    [acknowledgeNotifications]
  );

  const commandPaletteItems = useMemo(() => {
    const routeItems = navItems.map((item) => ({
      id: `route:${item.path}`,
      title: item.label,
      eyebrow: item.eyebrow,
      description: item.description,
      meta: item.path === location.pathname ? "Current route" : "Open workspace",
      badge: item.path === location.pathname ? "Open" : "",
      tone: item.path === location.pathname ? "active" : "",
      searchText: [item.label, item.eyebrow, item.description, item.path].join(" ").toLowerCase(),
      run: () => handleNavigate(item.path),
    }));

    const utilityItems = [
      ["Owner", "Manager"].includes(String(sessionUser?.role || ""))
        ? {
            id: "assistant",
            title: "Ask the business assistant",
            eyebrow: "Assistant",
            description: "Open the grounded owner assistant for live questions about sales, stock, suppliers, staff, and forecasting.",
            meta: "Ctrl answers",
            searchText: "assistant ai copilot owner intelligence forecast ask question",
            run: () => {
              window.dispatchEvent(new Event("afrospice:owner-ai:open"));
            },
          }
        : null,
      {
        id: "settings",
        title: "Open workspace controls",
        eyebrow: "Settings",
        description: "Go straight to operating rules, theme controls, and store configuration.",
        meta: "Preferences",
        searchText: "settings theme preferences store controls",
        run: () => handleNavigate("/settings"),
      },
      {
        id: "logout",
        title: "Sign out securely",
        eyebrow: "Session",
        description: "End the current workspace session and return to secure sign-in.",
        meta: "Logout",
        danger: true,
        searchText: "logout sign out exit session",
        run: onLogout,
      },
    ].filter(Boolean);

    return [...routeItems, ...utilityItems];
  }, [handleNavigate, location.pathname, navItems, onLogout, sessionUser?.role]);

  const filteredCommandItems = useMemo(() => {
    const term = commandQuery.trim().toLowerCase();
    if (!term) return commandPaletteItems;
    return commandPaletteItems.filter((item) => item.searchText.includes(term));
  }, [commandPaletteItems, commandQuery]);

  const recentCommandItems = useMemo(() => {
    const recentRoutes = readRecentRoutes();
    const recentSet = recentRoutes.filter((path) => path !== location.pathname);
    return recentSet
      .map((path) => navItems.find((item) => item.path === path))
      .filter(Boolean)
      .slice(0, 4)
      .map((item) => ({
        id: `recent:${item.path}`,
        title: item.label,
        eyebrow: item.eyebrow,
        description: item.description,
        meta: "Jump back in",
        recent: true,
        run: () => handleNavigate(item.path),
      }));
  }, [handleNavigate, location.pathname, navItems]);

  const handleCommandSelect = useCallback((item) => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
    item?.run?.();
  }, []);

  return (
    <div className={sidebarOpen ? `app workspace-shell route-theme-${routeTheme} sidebar-open` : `app workspace-shell route-theme-${routeTheme}`} data-route-theme={routeTheme}>
      <div
        className={sidebarOpen ? "sidebar-backdrop visible" : "sidebar-backdrop"}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />

      <aside className={sidebarOpen ? "sidebar is-open" : "sidebar"} aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <div className="sidebar-brand-main">
            <div className="brand-logo" aria-hidden="true">
              <span className="brand-logo-shape brand-logo-shape-top"></span>
              <span className="brand-logo-shape brand-logo-shape-bottom"></span>
            </div>
            <div className="sidebar-brand-copy">
              <div className="sidebar-brand-head">
                <h1 className="brand-title">AfroSpice</h1>
                <span className="sidebar-brand-badge">{settings.branchCode}</span>
              </div>
              <p className="brand-subtitle">{sidebarStoreLabel}</p>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <FiX />
          </button>
        </div>

        <div className="sidebar-welcome-card">
          <div
            className="sidebar-welcome-avatar"
            data-tone={profileTone}
            style={WELCOME_AVATAR_STYLES[profileTone] || WELCOME_AVATAR_STYLES.blue}
          >
            {profileInitials}
          </div>
          <div className="sidebar-welcome-copy">
            <span>Workspace owner</span>
            <strong>{sessionUser?.fullName?.split(" ")?.[0] || settings.managerName || "Operator"}</strong>
            <small>{`${sessionUser?.role || "Store staff"} � ${settings.branchCode}`}</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="sidebar-section">
              <span className="sidebar-section-title">{group.label}</span>
              <div className="sidebar-section-links">
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.path] || FiHome;
                  const itemMeta = getRouteMeta(item.path);
                  const routeTheme = resolveRouteTheme(item.path);

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      onMouseEnter={() => preloadRouteComponent(item.path)}
                      onFocus={() => preloadRouteComponent(item.path)}
                      onClick={() => {
                        rememberRoute(item.path);
                        setSidebarOpen(false);
                      }}
                      className={({ isActive }) => (isActive ? "sidebar-link active" : "sidebar-link")}
                    >
                      <span
                        className={`sidebar-link-icon sidebar-link-icon--${routeTheme}`}
                        style={SIDEBAR_ICON_STYLES[routeTheme] || SIDEBAR_ICON_STYLES.dashboard}
                        aria-hidden="true"
                      >
                        <Icon />
                      </span>
                      <span className="sidebar-link-copy">
                        <strong>{item.label}</strong>
                        <small>{itemMeta.eyebrow}</small>
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

          <div className="sidebar-footer">
            <div className="sidebar-footer-card">
              <div className="sidebar-footer-card-copy">
                <strong>{settings.storeName || "AfroSpice Main Branch"}</strong>
                <small>{sessionUser?.role || "Admin"} access on the live retail workspace.</small>
              </div>
            </div>

            <button type="button" className="sidebar-footer-action sidebar-footer-action--danger" onClick={onLogout}>
              <FiLogOut />
              <span>Logout</span>
            </button>
          </div>
      </aside>

      <section className="main workspace-main">
        <header className="topbar workspace-topbar">
          <div className="workspace-commandbar">
            <div className="workspace-commandbar-main">
              <button
                type="button"
                className="shell-nav-toggle"
                onClick={() => setSidebarOpen((current) => !current)}
                aria-label="Open navigation"
                aria-expanded={sidebarOpen}
              >
                <FiMenu />
              </button>

              <div className="workspace-commandbar-copy workspace-commandbar-copy--slim">
                <div className="workspace-title-stack">
                  <span className="workspace-command-chip">{routeMeta.label}</span>
                  <small>{routeMeta.description}</small>
                </div>
              </div>

              <button
                type="button"
                className="workspace-search-trigger"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Search workspace"
              >
                <span className="workspace-search-trigger-icon">
                  <FiSearch />
                </span>
                <span className="workspace-search-trigger-copy">
                  <strong>{searchPrompt}</strong>
                </span>
                <kbd>Ctrl K</kbd>
              </button>
            </div>

            <div className="workspace-commandbar-side">
              <div className="workspace-command-tools">
                {notificationsEnabled ? (
                  <div className="workspace-topbar-notification" ref={notificationRef}>
                    <button
                      type="button"
                      className={unreadNotificationCount > 0 ? "workspace-topbar-icon workspace-topbar-icon--alert" : "workspace-topbar-icon"}
                      aria-label="Notifications"
                      onClick={() => setNotificationOpen((current) => !current)}
                    >
                      <FiBell />
                      {unreadNotificationCount > 0 ? (
                        <span className="workspace-topbar-badge">
                          {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                        </span>
                      ) : null}
                    </button>

                    {notificationOpen ? (
                      <div className="workspace-notification-popover">
                        <div className="workspace-notification-header">
                          <div>
                            <strong>Workspace alerts</strong>
                            <small>
                              {notificationPayload?.generatedAt
                                ? `Updated ${formatNotificationTimestamp(notificationPayload.generatedAt)}`
                                : "Auto-ranked from live workspace data"}
                            </small>
                          </div>
                          <div className="workspace-notification-header-actions">
                            {unreadNotificationCount > 0 ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                onClick={() => acknowledgeNotifications({ markAll: true })}
                                disabled={notificationsMutating}
                              >
                                {notificationsMutating ? "Saving..." : "Acknowledge all"}
                              </button>
                            ) : null}
                            <span className="workspace-topbar-pill workspace-topbar-pill--soft">
                              {notificationItems.length} {notificationItems.length === 1 ? "alert" : "alerts"}
                            </span>
                          </div>
                        </div>

                        {notificationError ? (
                          <div className="info-banner inventory-error-banner">{notificationError}</div>
                        ) : null}

                        <div className="workspace-notification-list">
                          {!notificationItems.length && !notificationsLoading ? (
                            <div className="workspace-notification-empty">
                              <strong>Nothing urgent is open right now.</strong>
                              <p>The notification stream will surface inventory, order, supplier, security, and forecast pressure automatically.</p>
                            </div>
                          ) : null}

                          {notificationItems.map((item) => (
                            <article
                              key={item.id}
                              className={`workspace-notification-item workspace-notification-item--${item.tone || "neutral"} ${
                                item?.acknowledged ? "is-read" : "is-unread"
                              }`}
                            >
                              <div className="workspace-notification-copy">
                                <div className="workspace-notification-meta">
                                  <span className="workspace-notification-category">{item.category || "Operations"}</span>
                                  <small>{formatNotificationTimestamp(item.generatedAt)}</small>
                                </div>
                                <strong>{item.title}</strong>
                                <p>{item.detail}</p>
                              </div>
                              <div className="workspace-notification-actions">
                                {item?.acknowledged ? (
                                  <span className="workspace-notification-ack">
                                    Acknowledged {formatNotificationTimestamp(item?.acknowledgedAt || item?.generatedAt)}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-compact"
                                    onClick={() => handleNotificationAcknowledge(item)}
                                    disabled={notificationsMutating}
                                  >
                                    Acknowledge
                                  </button>
                                )}
                                {item?.action?.path ? (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-compact"
                                    onClick={() => handleNotificationAction(item)}
                                  >
                                    {item?.action?.label || "Open"}
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <span className="workspace-topbar-pill">
                  <FiMapPin />
                  {settings.branchCode}
                </span>
                <OwnerMenu settings={settings} sessionUser={sessionUser} onLogout={onLogout} />
              </div>
            </div>
          </div>
        </header>

        <main className="page-shell">{children}</main>
      </section>

      {["Owner", "Manager"].includes(String(sessionUser?.role || "")) ? (
        <Suspense fallback={null}>
          <OwnerAssistantDock sessionUser={sessionUser} />
        </Suspense>
      ) : null}

      <GlobalCommandPalette
        key={commandPaletteOpen ? `palette-${location.pathname}` : "palette-closed"}
        open={commandPaletteOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        onClose={() => {
          setCommandPaletteOpen(false);
          setCommandQuery("");
        }}
        onSelect={handleCommandSelect}
        recentItems={recentCommandItems}
        items={filteredCommandItems}
      />

      {sessionUser?.forcePinChange ? (
        <ForcePinChangeModal
          sessionUser={sessionUser}
          onUserUpdate={onUserUpdate}
          onLogout={onLogout}
        />
      ) : null}
    </div>
  );
}

function App() {
  const [loggedIn, setLoggedIn] = useState(() => hasAuthSession());
  const [sessionUser, setSessionUser] = useState(() => readStoredSessionUser());
  const [sessionReady, setSessionReady] = useState(() => !hasAuthSession());
  const [darkMode, setDarkMode] = useState(() => {
    const storedTheme = localStorage.getItem("afrospice_theme");

    if (storedTheme === "dark") return true;
    if (storedTheme === "light") return false;

    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false;
  });
  const { settings, settingsSaving, saveSettings } = useWorkspaceSettings(loggedIn);

  useEffect(() => {
    const themeName = darkMode ? "dark" : "light";
    const themeColor = darkMode ? "#0a0c10" : "#f7f9fd";
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');

    document.body.classList.toggle("dark", darkMode);
    document.body.dataset.theme = themeName;
    document.documentElement.dataset.theme = themeName;
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    if (themeColorMeta) {
      themeColorMeta.setAttribute("content", themeColor);
    }
    localStorage.setItem("afrospice_theme", themeName);
  }, [darkMode]);

  const handleLogout = useCallback(async () => {
    if (hasAuthSession()) {
      try {
        await API.post("/auth/logout");
      } catch (error) {
        console.error("Logout sync failed:", error);
      }
    }

    clearAuthSession();
    setLoggedIn(false);
    setSessionUser(null);
    setSessionReady(true);
  }, []);

  const handleLogin = useCallback((user) => {
    setLoggedIn(true);
    setSessionUser(user || readStoredSessionUser());
    setSessionReady(true);
  }, []);

  const handleUserUpdate = useCallback((user) => {
    setSessionUser(user || null);
    writeAuthSession(user || null);
  }, []);

  useEffect(() => {
    const syncLogout = () => {
      handleLogout();
    };

    window.addEventListener("afrospice:logout", syncLogout);
    return () => window.removeEventListener("afrospice:logout", syncLogout);
  }, [handleLogout]);

  useEffect(() => {
    let ignore = false;

    const hydrateSession = async () => {
      const sessionActive = hasAuthSession();

      if (!sessionActive) {
        if (!ignore) {
          setSessionUser(null);
          setSessionReady(true);
        }
        return;
      }

      if (!ignore) {
        setSessionReady(false);
      }

      try {
        const res = await API.get("/auth/me");
        const user = res?.data?.data?.user || readStoredSessionUser();

        if (!ignore) {
          setSessionUser(user || null);
          if (user) {
            writeAuthSession(user);
          }
        }
      } catch (error) {
        console.error("Failed to hydrate session:", error);
        if (!ignore) {
          handleLogout();
        }
      } finally {
        if (!ignore) {
          setSessionReady(true);
        }
      }
    };

    hydrateSession();

    return () => {
      ignore = true;
    };
  }, [loggedIn, handleLogout]);

  const role = sessionUser?.role || null;
  const currentSettings = settings || defaultSettings;

  return (
    <div className={darkMode ? "app-shell dark" : "app-shell"}>
      <Router>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route
              path="/login"
              element={
                loggedIn ? (
                  sessionReady ? (
                    <Navigate to={getDefaultRoute(role)} replace />
                  ) : (
                    <div className="app-boot-shell">Loading workspace session...</div>
                  )
                ) : (
                  <Suspense fallback={<RouteLoader />}>
                    <Login onLogin={handleLogin} settings={currentSettings} />
                  </Suspense>
                )
              }
            />

            <Route
              path="/"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={Dashboard}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading dashboard"
                      loadingDescription="Preparing the executive flight deck, live revenue, and stock signals."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/pos-dashboard/*"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={POSDashboard}
                      props={{
                        settings: currentSettings,
                        lowStockThreshold: Number(currentSettings.lowStockThreshold || 10),
                      }}
                      loadingTitle="Loading inventory command"
                      loadingDescription="Preparing replenishment, receiving, and stock health surfaces."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/terminal"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={POS}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading POS terminal"
                      loadingDescription="Preparing checkout controls, cart state, and receipt-ready selling tools."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/orders"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={Orders}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading orders"
                      loadingDescription="Preparing transaction flow, payment quality, and channel performance views."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/orders/refunds"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={RefundDesk}
                      props={{ settings: currentSettings, currentUser: sessionUser }}
                      loadingTitle="Loading refund desk"
                      loadingDescription="Preparing refund decisions, audit context, and approval controls."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/reports"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={Reports}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading reports"
                      loadingDescription="Preparing forecasting, category performance, and executive analysis surfaces."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={Customers}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading customers"
                      loadingDescription="Preparing customer intelligence, account detail, and outreach readiness."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers/new"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={CustomerProfile}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading customer profile"
                      loadingDescription="Preparing customer record, delivery context, and communications history."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers/:customerId"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={CustomerProfile}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading customer profile"
                      loadingDescription="Preparing customer record, delivery context, and communications history."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/suppliers"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={Suppliers}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading suppliers"
                      loadingDescription="Preparing supplier health, inbound risk, and lead-time control surfaces."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/suppliers/new"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={SupplierStudio}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading supplier studio"
                      loadingDescription="Preparing supplier profile, intake rules, and commercial detail."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/suppliers/:supplierId"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={SupplierStudio}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading supplier studio"
                      loadingDescription="Preparing supplier profile, intake rules, and commercial detail."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/purchase-orders/new"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={PurchaseOrderBuilder}
                      props={{ settings: currentSettings }}
                      loadingTitle="Loading procurement builder"
                      loadingDescription="Preparing purchase-order drafting, receiving paths, and supplier-linked controls."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/users"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={Users}
                      props={{ currentUser: sessionUser }}
                      loadingTitle="Loading workforce control"
                      loadingDescription="Preparing roster visibility, access policy, and staff operating context."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/users/staff/new"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={UserManagementDesk}
                      props={{ currentUser: sessionUser }}
                      loadingTitle="Loading user management desk"
                      loadingDescription="Preparing staff records, permissions, and oversight actions."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/users/staff/:userId"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={UserManagementDesk}
                      props={{ currentUser: sessionUser }}
                      loadingTitle="Loading user management desk"
                      loadingDescription="Preparing staff records, permissions, and oversight actions."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <LazyWorkspaceRoute
                      component={Settings}
                      pageKey={currentSettings.updatedAt || currentSettings.branchCode || "settings"}
                      props={{
                        darkMode,
                        setDarkMode,
                        settings: currentSettings,
                        onSaveSettings: saveSettings,
                        settingsSaving,
                        currentUser: sessionUser,
                        onLogout: handleLogout,
                      }}
                      loadingTitle="Loading operating controls"
                      loadingDescription="Preparing theme, policy, and workspace configuration controls."
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="*"
              element={
                <Suspense fallback={<RouteLoader />}>
                  <NotFound />
                </Suspense>
              }
            />
          </Routes>
        </Suspense>
      </Router>
    </div>
  );
}

export default App;




