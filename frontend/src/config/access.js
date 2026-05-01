export const NAV_ITEMS = [
  {
    path: "/",
    label: "Dashboard",
    eyebrow: "Executive Flight Deck",
    description: "Revenue, stock, cash, and next decisions in one owner view.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/pos-dashboard",
    label: "Inventory",
    eyebrow: "Inventory Command",
    description: "Owner-led replenishment, receiving, counts, and stock control.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/terminal",
    label: "POS Terminal",
    eyebrow: "Checkout Studio",
    description: "Owner-controlled selling, clean receipts, and live checkout control.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/orders",
    label: "Orders",
    eyebrow: "Transaction Intelligence",
    description: "Order quality, payment flow, refund approvals, and owner audit posture.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/reports",
    label: "Reports",
    eyebrow: "Strategy Studio",
    description: "Growth, category strength, product leaders, and forecasting.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/customers",
    label: "Customers",
    eyebrow: "Customer Intelligence",
    description: "Retention, named demand, walk-in dependence, and account quality.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/suppliers",
    label: "Suppliers",
    eyebrow: "Supplier Control",
    description: "Inbound exposure, fill rate, lead time, and supplier pressure.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/users",
    label: "User Management",
    eyebrow: "Workforce Control",
    description: "Owner review of staff records, roster health, and access discipline.",
    allowedRoles: ["Owner"],
  },
  {
    path: "/settings",
    label: "Settings",
    eyebrow: "Operating Controls",
    description: "Store profile, checkout policies, and workspace rules.",
    allowedRoles: ["Owner"],
  },
];

const SUPPORT_ROUTE_META = [
  {
    path: "/purchase-orders/new",
    label: "Procurement",
    eyebrow: "Inbound Builder",
    description: "Draft supplier-specific purchase orders with receiving and commercial detail.",
  },
];

export function canAccessRoute(role, allowedRoles = []) {
  if (!allowedRoles.length) return true;
  if (!role) return false;
  return allowedRoles.includes(role);
}

export function getVisibleNavItems(role) {
  return NAV_ITEMS.filter((item) => canAccessRoute(role, item.allowedRoles));
}

export function getDefaultRoute(role) {
  return getVisibleNavItems(role)[0]?.path || "/";
}

export function getRouteMeta(pathname) {
  const supportRoute = SUPPORT_ROUTE_META.find((item) => pathname.startsWith(item.path));
  if (supportRoute) {
    return supportRoute;
  }

  return (
    NAV_ITEMS.find((item) =>
      item.path === "/" ? pathname === "/" : pathname.startsWith(item.path)
    ) || NAV_ITEMS[0]
  );
}
