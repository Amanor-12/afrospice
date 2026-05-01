import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaAddressCard as FiAddressCard,
  FaBasketShopping as FiShoppingBag,
  FaBoxArchive as FiPackage,
  FaChartLine as FiActivity,
  FaDollarSign as FiDollarSign,
  FaMagnifyingGlass as FiSearch,
  FaUserPlus as FiUserPlus,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import { LIVE_PAGE_POLL_INTERVAL_MS } from "./pageRuntime";
import {
  formatDate,
  formatMoney,
  getResponseData,
  normalizeCollectionPayload,
  toArray,
  toNumber,
} from "./shared/dataHelpers";
import { getProductVisual } from "./shared/productVisuals";
import SoftPagination from "./shared/SoftPagination";
import WorkspaceBannerStack from "./shared/WorkspaceBannerStack";
import WorkspaceDataStatus from "./shared/WorkspaceDataStatus";

const DEFAULT_CHECKOUT = {
  customer: "Walk-in Customer",
  customerId: null,
  paymentMethod: "Card",
  channel: "In-Store",
  status: "Paid",
};
const CATALOG_PAGE_SIZE = 18;

function buildCheckoutSnapshot(checkout = {}) {
  return {
    customer: String(checkout?.customer || DEFAULT_CHECKOUT.customer).trim() || DEFAULT_CHECKOUT.customer,
    customerId: checkout?.customerId ? Number(checkout.customerId) : null,
    paymentMethod: String(checkout?.paymentMethod || DEFAULT_CHECKOUT.paymentMethod).trim() || DEFAULT_CHECKOUT.paymentMethod,
    channel: String(checkout?.channel || DEFAULT_CHECKOUT.channel).trim() || DEFAULT_CHECKOUT.channel,
    status: String(checkout?.status || DEFAULT_CHECKOUT.status).trim() || DEFAULT_CHECKOUT.status,
  };
}

function isWalkInCustomerLabel(value = "") {
  return String(value || "").trim().toLowerCase() === "walk-in customer";
}

function customerMatchesTerm(customer = {}, term = "") {
  const normalizedTerm = String(term || "").trim().toLowerCase();
  if (!normalizedTerm) return false;

  return [
    customer?.name,
    customer?.customerNumber,
    customer?.loyaltyNumber,
    customer?.loyaltyCardNumber,
    customer?.email,
    customer?.phone,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedTerm);
}

function escapeReceiptHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReceiptDocument({ sale, settings, currency }) {
  const storeName = String(settings?.storeName || "AfroSpice").trim() || "AfroSpice";
  const branchCode = String(settings?.branchCode || "").trim();
  const receiptFooter =
    String(settings?.receiptFooter || "Thank you for shopping with AfroSpice.").trim() ||
    "Thank you for shopping with AfroSpice.";
  const saleDate = sale?.date || sale?.createdAt || new Date().toISOString();
  const receiptTimestamp = new Date(saleDate);
  const receiptDateLabel = Number.isNaN(receiptTimestamp.getTime())
    ? String(saleDate || "")
    : receiptTimestamp.toLocaleString();
  const itemsMarkup = toArray(sale?.items)
    .map((item) => {
      const quantity = Math.max(1, Number(item?.qty || 1));
      const unitPrice = formatMoney(currency, item?.price);
      const lineSubtotal = formatMoney(currency, item?.lineSubtotal ?? item?.lineTotal);
      const lineTax = formatMoney(currency, item?.taxAmount);
      const lineGross = formatMoney(currency, item?.lineGrossTotal ?? item?.lineTotal);

      return `
        <li class="receipt-line">
          <div class="receipt-line-head">
            <strong>${escapeReceiptHtml(item?.name || "Item")}</strong>
            <span>${escapeReceiptHtml(lineGross)}</span>
          </div>
          <div class="receipt-line-meta">
            <span>${quantity} x ${escapeReceiptHtml(unitPrice)}</span>
            <span>${escapeReceiptHtml(String(item?.sku || "No SKU"))}</span>
          </div>
          <div class="receipt-line-meta">
            <span>Subtotal ${escapeReceiptHtml(lineSubtotal)}</span>
            <span>Tax ${escapeReceiptHtml(lineTax)}</span>
          </div>
        </li>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeReceiptHtml(storeName)} Receipt</title>
    <style>
      @page { margin: 10mm; }
      body {
        margin: 0;
        color: #0f172a;
        background: #ffffff;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 12px;
      }
      .receipt {
        width: 80mm;
        max-width: 100%;
        margin: 0 auto;
      }
      .receipt-header,
      .receipt-section,
      .receipt-summary,
      .receipt-footer {
        border-bottom: 1px dashed #cbd5e1;
      }
      .receipt-header {
        padding-bottom: 10px;
        margin-bottom: 10px;
        text-align: center;
      }
      .receipt-header h1 {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
      }
      .receipt-header p {
        margin: 4px 0 0;
        color: #475569;
      }
      .receipt-grid {
        display: grid;
        gap: 6px;
        margin-bottom: 10px;
      }
      .receipt-grid-row,
      .receipt-summary-row,
      .receipt-line-head,
      .receipt-line-meta {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .receipt-grid-row span:first-child,
      .receipt-summary-row span:first-child,
      .receipt-line-meta span:first-child {
        color: #475569;
      }
      .receipt-lines {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .receipt-line {
        padding: 8px 0;
        border-top: 1px dashed #e2e8f0;
      }
      .receipt-line:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .receipt-line-head strong {
        font-size: 12.5px;
      }
      .receipt-line-meta {
        margin-top: 2px;
        font-size: 11px;
      }
      .receipt-summary {
        padding: 10px 0;
        margin: 10px 0;
      }
      .receipt-summary-row.total {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #cbd5e1;
        font-size: 14px;
        font-weight: 700;
      }
      .receipt-footer {
        border-bottom: 0;
        padding-top: 10px;
        text-align: center;
        color: #475569;
      }
    </style>
  </head>
  <body>
    <main class="receipt">
      <header class="receipt-header">
        <h1>${escapeReceiptHtml(storeName)}</h1>
        <p>${escapeReceiptHtml(branchCode || "Main branch")}</p>
      </header>

      <section class="receipt-section">
        <div class="receipt-grid">
          <div class="receipt-grid-row"><span>Receipt</span><strong>${escapeReceiptHtml(sale?.id || "Pending")}</strong></div>
          <div class="receipt-grid-row"><span>Date</span><strong>${escapeReceiptHtml(receiptDateLabel)}</strong></div>
          <div class="receipt-grid-row"><span>Cashier</span><strong>${escapeReceiptHtml(sale?.cashier || "Front Desk")}</strong></div>
          <div class="receipt-grid-row"><span>Customer</span><strong>${escapeReceiptHtml(sale?.customer || "Walk-in Customer")}</strong></div>
          <div class="receipt-grid-row"><span>Payment</span><strong>${escapeReceiptHtml(sale?.paymentMethod || "Card")}</strong></div>
          <div class="receipt-grid-row"><span>Channel</span><strong>${escapeReceiptHtml(sale?.channel || "In-Store")}</strong></div>
          <div class="receipt-grid-row"><span>Status</span><strong>${escapeReceiptHtml(sale?.status || "Paid")}</strong></div>
        </div>
      </section>

      <section class="receipt-section">
        <ul class="receipt-lines">
          ${itemsMarkup || '<li class="receipt-line"><div class="receipt-line-head"><strong>No line items returned</strong><span></span></div></li>'}
        </ul>
      </section>

      <section class="receipt-summary">
        <div class="receipt-summary-row"><span>Pre-discount</span><strong>${escapeReceiptHtml(formatMoney(currency, sale?.preDiscountSubtotal ?? sale?.subtotal))}</strong></div>
        ${
          Number(sale?.discount || 0) > 0
            ? `<div class="receipt-summary-row"><span>Discount</span><strong>-${escapeReceiptHtml(formatMoney(currency, sale?.discount))}</strong></div>`
            : ""
        }
        <div class="receipt-summary-row"><span>Subtotal</span><strong>${escapeReceiptHtml(formatMoney(currency, sale?.subtotal))}</strong></div>
        <div class="receipt-summary-row"><span>Ontario HST</span><strong>${escapeReceiptHtml(formatMoney(currency, sale?.tax))}</strong></div>
        <div class="receipt-summary-row total"><span>Total</span><strong>${escapeReceiptHtml(formatMoney(currency, sale?.total))}</strong></div>
      </section>

      <footer class="receipt-footer">
        <p>${escapeReceiptHtml(receiptFooter)}</p>
      </footer>
    </main>
  </body>
</html>`;
}

function printSaleReceipt({ sale, settings, currency }) {
  if (typeof window === "undefined" || typeof document === "undefined" || !sale) {
    return false;
  }

  const printFrame = document.createElement("iframe");
  printFrame.setAttribute("aria-hidden", "true");
  printFrame.style.position = "fixed";
  printFrame.style.right = "0";
  printFrame.style.bottom = "0";
  printFrame.style.width = "0";
  printFrame.style.height = "0";
  printFrame.style.border = "0";
  printFrame.style.opacity = "0";
  document.body.appendChild(printFrame);

  const cleanup = () => {
    window.setTimeout(() => {
      printFrame.remove();
    }, 300);
  };

  const frameWindow = printFrame.contentWindow;
  const frameDocument = frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    cleanup();
    return false;
  }

  frameWindow.onafterprint = cleanup;
  frameDocument.open();
  frameDocument.write(buildReceiptDocument({ sale, settings, currency }));
  frameDocument.close();

  window.setTimeout(() => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      cleanup();
    }
  }, 180);

  return true;
}

function PosCatalogCardPremium({ product, currency, onAdd }) {
  const visual = getProductVisual(product);
  const taxRate = toNumber(product?.taxRate);
  const taxLabel = String(product?.taxLabel || (taxRate > 0 ? "Ontario HST" : "Zero-rated grocery"));
  const stock = Math.max(0, toNumber(product?.stock));
  const inStock = stock > 0;
  const categoryLabel = String(product?.category || "General grocery").trim() || "General grocery";
  const productName = String(product?.name || "Unnamed product").trim() || "Unnamed product";
  const supplierLabel = String(product?.supplier || "").trim();
  const skuLabel = String(product?.sku || "").trim();
  const catalogNote = skuLabel
    ? `SKU ${skuLabel}`
    : supplierLabel || taxLabel;

  return (
    <button
      type="button"
      className={`pos-catalog-card${inStock ? "" : " is-unavailable"}`}
      onClick={() => onAdd(product)}
      disabled={!inStock}
      aria-label={`${inStock ? "Add" : "View"} ${productName}${inStock ? " to the current ticket" : ""}`}
    >
      <div className={`pos-catalog-card-media pos-catalog-card-media--${visual.tone}`}>
        <img src={visual.image} alt={visual.alt} />
      </div>

      <div className="pos-catalog-card-copy">
        <strong>{productName}</strong>
        <small>{categoryLabel}</small>
      </div>

      <div className="pos-catalog-card-tags">
        <span className={`pos-catalog-chip${taxRate > 0 ? " is-taxable" : " is-zero-rated"}`}>
          {taxRate > 0 ? `${taxRate}% HST` : "Zero-rated"}
        </span>
        <small className="pos-catalog-card-note">{catalogNote}</small>
      </div>

      <div className="pos-catalog-card-footer">
        <span className="pos-catalog-card-price">{formatMoney(currency, product?.price)}</span>
        <span className={`pos-catalog-stock${inStock ? "" : " is-out"}`}>
          {inStock ? `${stock} in stock` : "Sold out"}
        </span>
      </div>
    </button>
  );
}

function PosCartRowPremium({
  line,
  currency,
  customerDiscountPercent = 0,
  onIncrease,
  onDecrease,
  onRemove,
}) {
  const taxRate = toNumber(line?.taxRate);
  const taxLabel = String(line?.taxLabel || (taxRate > 0 ? "Taxable item" : "Zero-rated grocery"));
  const lineBaseSubtotal = Number((toNumber(line?.price) * toNumber(line?.qty)).toFixed(2));
  const discountAmount = Number(((lineBaseSubtotal * customerDiscountPercent) / 100).toFixed(2));
  const lineSubtotal = Number((lineBaseSubtotal - discountAmount).toFixed(2));
  const lineTax = Number(((lineSubtotal * taxRate) / 100).toFixed(2));
  const lineGrossTotal = Number((lineSubtotal + lineTax).toFixed(2));

  return (
    <article className="pos-ref-order-row">
      <div className="pos-ref-order-copy">
        <strong>{line.name}</strong>
        <div className="pos-ref-order-meta">
          <small>{line.sku || "No SKU"}</small>
          <span className={`pos-ref-tax-chip${taxRate > 0 ? " is-taxable" : " is-zero-rated"}`}>
            {taxRate > 0 ? `${taxRate}% HST` : "0% grocery"}
          </span>
        </div>
        <small className="pos-ref-order-tax">
          {taxLabel}
          {" - "}
          {taxRate > 0 ? "taxable in Ontario" : "zero-rated in Ontario"}
        </small>
      </div>

      <div className="pos-ref-order-tools">
        <div className="pos-ref-qty-stepper">
          <button type="button" onClick={onDecrease} aria-label={`Decrease ${line.name}`}>
            -
          </button>
          <span>{line.qty}</span>
          <button type="button" onClick={onIncrease} aria-label={`Increase ${line.name}`}>
            +
          </button>
        </div>
        <div className="pos-ref-order-value">
          <strong>{formatMoney(currency, lineSubtotal)}</strong>
          {discountAmount > 0 ? (
            <small>{`- ${formatMoney(currency, discountAmount)} loyalty`}</small>
          ) : null}
          <small>{lineTax > 0 ? `+ ${formatMoney(currency, lineTax)} HST` : "0% HST"}</small>
          <small className="pos-ref-order-gross">{formatMoney(currency, lineGrossTotal)} gross</small>
        </div>
        <button type="button" className="pos-ref-remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    </article>
  );
}

function POS({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [recentSales, setRecentSales] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [catalogPage, setCatalogPage] = useState(1);
  const [cart, setCart] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSale, setLastSale] = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());
  const [checkout, setCheckout] = useState(DEFAULT_CHECKOUT);

  const deferredQuery = useDeferredValue(query);
  const currency = settings?.currency || "USD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [productsResponse, salesResponse, customersResponse] = await Promise.all([
          API.get("/products"),
          API.get("/sales"),
          API.get("/customers"),
        ]);

        if (cancelled) return;

        startTransition(() => {
          const productPayload = normalizeCollectionPayload(getResponseData(productsResponse), ["products"]);
          const salesPayload = normalizeCollectionPayload(getResponseData(salesResponse), ["sales"]).slice(0, 16);
          const customerPayload = normalizeCollectionPayload(getResponseData(customersResponse), ["customers"]);
          setProducts(productPayload);
          setRecentSales(salesPayload);
          setCustomers(customerPayload);
          setLastUpdated(
            String(
              salesPayload[0]?.updatedAt ||
                salesPayload[0]?.date ||
                productPayload[0]?.updatedAt ||
                new Date().toISOString()
            )
          );
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load POS data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, LIVE_PAGE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const routeState = location.state || {};
    if (Object.prototype.hasOwnProperty.call(routeState, "prefillCustomer")) {
      setCheckout((current) => ({
        ...current,
        customer: String(routeState.prefillCustomer || "Walk-in Customer"),
        customerId: routeState.prefillCustomerId ? Number(routeState.prefillCustomerId) : null,
      }));
    }

    if (routeState.openAdvancedCheckout) {
      setAdvancedOpen(true);
    }
  }, [location.key, location.state]);

  const categories = useMemo(() => {
    const all = new Set(["All"]);
    for (const product of products) {
      if (product?.category) all.add(String(product.category));
    }
    return [...all];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = String(deferredQuery || "").trim().toLowerCase();
    return products.filter((product) => {
      if (category !== "All" && String(product?.category || "") !== category) return false;
      if (!term) return true;

      return [product?.name, product?.sku, product?.barcode].some((field) =>
        String(field || "")
          .toLowerCase()
          .includes(term)
      );
    });
  }, [products, deferredQuery, category]);

  useEffect(() => {
    setCatalogPage(1);
  }, [category, deferredQuery, products.length]);

  const catalogTotalPages = Math.max(1, Math.ceil(filteredProducts.length / CATALOG_PAGE_SIZE));
  const activeCatalogPage = Math.min(catalogPage, catalogTotalPages);
  const catalogPreview = filteredProducts.slice(
    (activeCatalogPage - 1) * CATALOG_PAGE_SIZE,
    activeCatalogPage * CATALOG_PAGE_SIZE
  );
  const catalogVisibleStart = filteredProducts.length
    ? (activeCatalogPage - 1) * CATALOG_PAGE_SIZE + 1
    : 0;
  const catalogVisibleEnd = filteredProducts.length
    ? Math.min(activeCatalogPage * CATALOG_PAGE_SIZE, filteredProducts.length)
    : 0;
  const activeCategoryLabel = category === "All" ? "All categories" : category;
  const normalizedCustomerQuery = String(checkout.customer || "").trim().toLowerCase();
  const normalizedCustomerSearchValue = String(checkout.customer || "").trim();
  const selectedCustomer = useMemo(() => {
    if (checkout.customerId) {
      return customers.find((customer) => Number(customer?.id) === Number(checkout.customerId)) || null;
    }

    if (!normalizedCustomerQuery || isWalkInCustomerLabel(checkout.customer)) {
      return null;
    }

    return (
      customers.find((customer) =>
        [
          customer?.name,
          customer?.customerNumber,
          customer?.loyaltyNumber,
          customer?.loyaltyCardNumber,
          customer?.email,
          customer?.phone,
        ]
          .map((value) => String(value || "").trim().toLowerCase())
          .filter(Boolean)
          .includes(normalizedCustomerQuery)
      ) || null
    );
  }, [checkout.customer, checkout.customerId, customers, normalizedCustomerQuery]);

  const customerSuggestions = useMemo(() => {
    if (!normalizedCustomerQuery || isWalkInCustomerLabel(checkout.customer)) {
      return [];
    }

    if (
      selectedCustomer &&
      String(selectedCustomer?.name || "").trim().toLowerCase() === normalizedCustomerQuery
    ) {
      return [];
    }

    return customers
      .filter((customer) => !customer?.isWalkIn && customerMatchesTerm(customer, normalizedCustomerQuery))
      .slice(0, 5);
  }, [checkout.customer, customers, normalizedCustomerQuery, selectedCustomer]);

  const canCreateCustomerRecord = Boolean(
    normalizedCustomerQuery &&
      !isWalkInCustomerLabel(checkout.customer) &&
      !selectedCustomer &&
      !customerSuggestions.length
  );
  const activeCustomerDiscountPercent =
    selectedCustomer && selectedCustomer?.discountEligible ? toNumber(selectedCustomer?.discountPercent) : 0;

  const estimatedBaseSubtotal = useMemo(
    () => cart.reduce((sum, line) => sum + toNumber(line?.price) * toNumber(line?.qty), 0),
    [cart]
  );
  const estimatedDiscount = useMemo(
    () => Number(((estimatedBaseSubtotal * activeCustomerDiscountPercent) / 100).toFixed(2)),
    [activeCustomerDiscountPercent, estimatedBaseSubtotal]
  );
  const estimatedSubtotal = Number((estimatedBaseSubtotal - estimatedDiscount).toFixed(2));
  const estimatedTax = useMemo(
    () =>
      Number(
        cart
          .reduce(
            (sum, line) =>
              sum +
              ((toNumber(line?.price) * toNumber(line?.qty) -
                (toNumber(line?.price) * toNumber(line?.qty) * activeCustomerDiscountPercent) / 100) *
                toNumber(line?.taxRate)) /
                100,
            0
          )
          .toFixed(2)
      ),
    [activeCustomerDiscountPercent, cart]
  );
  const estimatedTotal = estimatedSubtotal + estimatedTax;
  const taxSummary = useMemo(() => {
    const taxableLines = cart.filter((line) => toNumber(line?.taxRate) > 0);
    const zeroRatedLines = cart.filter((line) => toNumber(line?.taxRate) <= 0);
    const taxableSubtotal = taxableLines.reduce(
      (sum, line) => sum + toNumber(line?.price) * toNumber(line?.qty),
      0
    );
    const zeroRatedSubtotal = zeroRatedLines.reduce(
      (sum, line) => sum + toNumber(line?.price) * toNumber(line?.qty),
      0
    );

    return {
      taxableLines: taxableLines.length,
      zeroRatedLines: zeroRatedLines.length,
      taxableSubtotal: Number(taxableSubtotal.toFixed(2)),
      zeroRatedSubtotal: Number(zeroRatedSubtotal.toFixed(2)),
      estimatedDiscount,
      taxablePreviewNames: taxableLines
        .slice(0, 3)
        .map((line) => String(line?.name || "").trim())
        .filter(Boolean),
      zeroRatedPreviewNames: zeroRatedLines
        .slice(0, 3)
        .map((line) => String(line?.name || "").trim())
        .filter(Boolean),
    };
  }, [cart, estimatedDiscount]);
  const taxSummaryCopy = useMemo(() => {
    if (!cart.length) {
      return "Tax updates automatically as soon as items are added to the ticket.";
    }

    if (!taxSummary.taxableLines) {
      return `This ticket is currently all zero-rated grocery items in Ontario, so HST is ${formatMoney(
        currency,
        0
      )}${estimatedDiscount > 0 ? ` after a ${activeCustomerDiscountPercent}% loyalty discount.` : "."}`;
    }

    if (!taxSummary.zeroRatedLines) {
      return `${taxSummary.taxableLines} taxable line${
        taxSummary.taxableLines === 1 ? "" : "s"
      } are applying Ontario HST to ${formatMoney(currency, taxSummary.taxableSubtotal)}${
        estimatedDiscount > 0 ? ` after a ${activeCustomerDiscountPercent}% loyalty discount` : ""
      }.`;
    }

    return `${taxSummary.taxableLines} taxable line${
      taxSummary.taxableLines === 1 ? "" : "s"
    } are applying Ontario HST to ${formatMoney(
      currency,
      taxSummary.taxableSubtotal
    )}, while ${taxSummary.zeroRatedLines} grocery line${
      taxSummary.zeroRatedLines === 1 ? "" : "s"
    } stay zero-rated${estimatedDiscount > 0 ? ` after a ${activeCustomerDiscountPercent}% loyalty discount` : ""}.`;
  }, [activeCustomerDiscountPercent, cart.length, currency, estimatedDiscount, taxSummary]);
  const taxSummaryExamples = useMemo(() => {
    if (!cart.length) return "";

    if (!taxSummary.taxableLines) {
      return taxSummary.zeroRatedPreviewNames.length
        ? `Current zero-rated items: ${taxSummary.zeroRatedPreviewNames.join(", ")}.`
        : "";
    }

    if (!taxSummary.zeroRatedLines) {
      return taxSummary.taxablePreviewNames.length
        ? `Current taxable items: ${taxSummary.taxablePreviewNames.join(", ")}.`
        : "";
    }

    const taxableLabel = taxSummary.taxablePreviewNames.length
      ? `Taxable: ${taxSummary.taxablePreviewNames.join(", ")}.`
      : "";
    const zeroRatedLabel = taxSummary.zeroRatedPreviewNames.length
      ? ` Zero-rated: ${taxSummary.zeroRatedPreviewNames.join(", ")}.`
      : "";

    return `${taxableLabel}${zeroRatedLabel}`.trim();
  }, [cart.length, taxSummary]);
  const basketTaxMode = useMemo(() => {
    if (!cart.length) return "No items";
    if (activeCustomerDiscountPercent > 0 && !taxSummary.taxableLines) return "Discounted grocery basket";
    if (activeCustomerDiscountPercent > 0 && !taxSummary.zeroRatedLines) return "Discounted taxable basket";
    if (activeCustomerDiscountPercent > 0) return "Discounted mixed basket";
    if (!taxSummary.taxableLines) return "Zero-rated groceries";
    if (!taxSummary.zeroRatedLines) return "Taxable basket";
    return "Mixed basket";
  }, [
    activeCustomerDiscountPercent,
    cart.length,
    taxSummary.taxableLines,
    taxSummary.zeroRatedLines,
  ]);
  const taxLineLabel = useMemo(() => {
    if (!cart.length) return "Ontario HST";
    if (!taxSummary.taxableLines) return "Ontario HST (0% grocery basket)";
    if (!taxSummary.zeroRatedLines) return "Ontario HST (taxable items)";
    return "Ontario HST (mixed basket)";
  }, [cart.length, taxSummary.taxableLines, taxSummary.zeroRatedLines]);

  const latestTicket = lastSale || recentSales[0] || null;
  const paidTicketCount = recentSales.filter((sale) => String(sale?.status || "").toLowerCase() === "paid").length;
  const recentCapturedRevenue = recentSales.reduce((sum, sale) => {
    if (String(sale?.status || "").toLowerCase() !== "paid") return sum;
    return sum + toNumber(sale?.total);
  }, 0);
  const averageTicketValue = paidTicketCount > 0 ? recentCapturedRevenue / paidTicketCount : 0;

  const summaryCards = [
    {
      label: "Visible Products",
      value: `${filteredProducts.length}`,
      note: filteredProducts.length
        ? `${catalogVisibleStart}-${catalogVisibleEnd} on page ${activeCatalogPage} of ${catalogTotalPages}`
        : "No products in the current filter",
      icon: FiPackage,
    },
    {
      label: "Paid Tickets",
      value: `${paidTicketCount}`,
      note: `${formatMoney(currency, recentCapturedRevenue)} settled in recent checkout activity`,
      icon: FiShoppingBag,
    },
    {
      label: "Average Ticket",
      value: formatMoney(currency, averageTicketValue),
      note: latestTicket?.id ? `Latest ticket ${latestTicket.id}` : "No settled ticket yet",
      icon: FiActivity,
    },
    {
      label: "Current Basket",
      value: formatMoney(currency, estimatedTotal),
      note: `${cart.length} line${cart.length === 1 ? "" : "s"} ready for checkout`,
      icon: FiDollarSign,
    },
  ];
  const ticketDirty = useMemo(
    () =>
      cart.length > 0 ||
      advancedOpen ||
      JSON.stringify(buildCheckoutSnapshot(checkout)) !== JSON.stringify(buildCheckoutSnapshot(DEFAULT_CHECKOUT)),
    [advancedOpen, cart.length, checkout]
  );
  const ticketStatus = useMemo(() => {
    if (!cart.length) {
      return {
        label: "Awaiting basket",
        note: "Start from the catalog to build the next live sale.",
        tone: ticketDirty ? "warning" : "neutral",
      };
    }

    if (selectedCustomer?.discountEligible) {
      return {
        label: "Ready to collect",
        note: `${selectedCustomer.discountPercent || 0}% named-customer pricing is active on this ticket.`,
        tone: "success",
      };
    }

    if (selectedCustomer) {
      return {
        label: "Named customer selected",
        note: "Checkout is linked to a saved customer record, but loyalty pricing is not active on this basket.",
        tone: "brand",
      };
    }

    return {
      label: "Walk-in ticket",
      note: "This basket can be collected now, or converted into a named customer checkout.",
      tone: "warning",
    };
  }, [cart.length, selectedCustomer, ticketDirty]);

  const resetTicket = () => {
    setCart([]);
    setCheckout(DEFAULT_CHECKOUT);
    setAdvancedOpen(false);
    setError("");
    setNotice("");
  };

  const updateLineQty = (productId, nextQty) => {
    setCart((current) => {
      const quantity = Math.max(1, Math.floor(toNumber(nextQty, 1)));
      return current.map((line) =>
        Number(line.productId) === Number(productId)
          ? {
              ...line,
              qty: quantity,
            }
          : line
      );
    });
  };

  const addProductToCart = (product) => {
    const productId = toNumber(product?.id, 0);
    if (!productId) return;

    setCart((current) => {
      const existing = current.find((line) => Number(line.productId) === productId);
      if (existing) {
        return current.map((line) =>
          Number(line.productId) === productId
            ? {
                ...line,
                qty: line.qty + 1,
              }
            : line
        );
      }

      return [
        ...current,
        {
          productId,
          name: String(product?.name || "Unnamed product"),
          sku: String(product?.sku || ""),
          price: toNumber(product?.price),
          taxClass: String(product?.taxClass || ""),
          taxLabel: String(product?.taxLabel || ""),
          taxRate: toNumber(product?.taxRate),
          qty: 1,
        },
      ];
    });
  };

  const removeCartLine = (productId) => {
    setCart((current) => current.filter((line) => Number(line.productId) !== Number(productId)));
  };

  const printLatestReceipt = () => {
    if (!latestTicket) return;
    printSaleReceipt({ sale: latestTicket, settings, currency });
  };

  const submitSale = async () => {
    if (!cart.length || submitting) return;

    try {
      setSubmitting(true);
      setError("");
      setNotice("");

      const payload = {
        items: cart.map((line) => ({
          productId: line.productId,
          qty: Math.max(1, Math.floor(toNumber(line.qty, 1))),
        })),
        customerId: selectedCustomer?.id ?? checkout.customerId ?? null,
        customer: selectedCustomer?.name || checkout.customer || "Walk-in Customer",
        paymentMethod: checkout.paymentMethod,
        channel: checkout.channel,
        status: checkout.status,
      };

      const response = await API.post("/sales", payload);
      const sale = getResponseData(response) || {};
      setLastSale(sale);
      setCart([]);
      setCheckout(DEFAULT_CHECKOUT);
      setAdvancedOpen(false);
      setNotice(`Sale ${sale?.id || ""} posted successfully. Opening receipt print dialog.`);
      window.setTimeout(() => {
        printSaleReceipt({ sale, settings, currency });
      }, 80);

      const [productsResponse, salesResponse] = await Promise.all([API.get("/products"), API.get("/sales")]);
      startTransition(() => {
        const productPayload = normalizeCollectionPayload(getResponseData(productsResponse), ["products"]);
        const salesPayload = normalizeCollectionPayload(getResponseData(salesResponse), ["sales"]).slice(0, 16);
        setProducts(productPayload);
        setRecentSales(salesPayload);
        setLastUpdated(
          String(
            salesPayload[0]?.updatedAt ||
              salesPayload[0]?.date ||
              productPayload[0]?.updatedAt ||
              new Date().toISOString()
          )
        );
      });
    } catch (submitError) {
      setError(submitError?.message || "Could not post sale.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container pos-terminal-page pos-reference-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      <WorkspaceBannerStack error={error} notice={notice} />

      <section className="reference-page-heading pos-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Checkout workspace</span>
          <h1>POS</h1>
          <p>Run checkout from one clean catalog surface and a single live basket.</p>
        </div>

        <div className="pos-reference-heading-actions">
          <WorkspaceDataStatus
            loading={loading}
            live={!loading && Boolean(lastUpdated)}
            liveIndicatorLabel="Live POS catalog and sales"
            timestamp={lastUpdated}
            nowTick={nowTick}
            useRelativeTime
            showPausedBadge
          />
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/pos-dashboard")}>
            Open Inventory
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/orders")}>
            Open Orders
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdvancedOpen((open) => !open)}>
            {advancedOpen ? "Hide Advanced" : "Advanced Checkout"}
          </button>
        </div>
      </section>

      <section className="pos-reference-stat-strip">
        {summaryCards.map((card) => (
          <article key={card.label} className="pos-reference-stat">
            <div className="reference-stat-head">
              <div className="reference-stat-icon">{card.icon ? <card.icon /> : null}</div>
            </div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="pos-reference-shell">
        <div className="pos-catalog-surface">
          <div className="pos-catalog-toolbar">
            <label className="reference-inline-search pos-catalog-search">
              <FiSearch />
              <input
                className="input"
                type="text"
                placeholder="Search products, SKU, or barcode"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="pos-catalog-toolbar-meta">
              <div className="pos-catalog-toolbar-meta-copy">
                <strong>{activeCategoryLabel}</strong>
                <small>
                  {filteredProducts.length
                    ? `${catalogVisibleStart}-${catalogVisibleEnd} of ${filteredProducts.length} live products`
                    : "No live products in this filter"}
                </small>
              </div>
              <label className="pos-catalog-category-shell">
                <span className="reference-page-kicker">Category</span>
                <select
                  className="toolbar-select pos-catalog-category-select"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {categories.map((option) => (
                    <option key={option} value={option}>
                      {option === "All" ? "All categories" : option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {loading ? (
            <div className="pos-catalog-feedback" role="status" aria-live="polite">
              <strong>Loading live catalog</strong>
              <p>Pulling the latest products, prices, and stock levels into checkout.</p>
            </div>
          ) : !filteredProducts.length ? (
            <div className="pos-catalog-feedback">
              <strong>No products match this filter</strong>
              <p>Clear the search or switch categories to reopen the live catalog.</p>
            </div>
          ) : (
            <>
              <div className="pos-catalog-grid">
                {catalogPreview.map((product) => (
                  <PosCatalogCardPremium
                    key={product.id}
                    product={product}
                    currency={currency}
                    onAdd={addProductToCart}
                  />
                ))}
              </div>
              <div className="pos-catalog-footer">
                <div className="pos-catalog-meta">
                  <strong>
                    Showing {catalogVisibleStart}-{catalogVisibleEnd} of {filteredProducts.length} products
                  </strong>
                  <small>Use the pager to move through the rest of the live catalog.</small>
                </div>
                <SoftPagination
                  currentPage={activeCatalogPage}
                  totalPages={catalogTotalPages}
                  onChange={setCatalogPage}
                  label="Product catalog pages"
                />
              </div>
            </>
          )}
        </div>

        <aside className="pos-reference-summary">
          <div className="pos-reference-summary-head">
            <div>
              <span className="reference-page-kicker">Order summary</span>
              <h2>Current ticket</h2>
            </div>
            <div className="pos-reference-summary-status">
              <span className="status-pill small neutral">{latestTicket?.id || "No ticket yet"}</span>
              <span
                className={`pos-ref-tax-chip${
                  taxSummary.taxableLines ? " is-taxable" : " is-zero-rated"
                }`}
              >
                {basketTaxMode}
              </span>
            </div>
          </div>

          <div className={`pos-reference-ticket-status pos-reference-ticket-status--${ticketStatus.tone}`}>
            <div className="pos-reference-ticket-status-copy">
              <span className="reference-page-kicker">Live ticket status</span>
              <strong>{ticketStatus.label}</strong>
              <small>{ticketStatus.note}</small>
            </div>
            <div className="pos-reference-ticket-status-actions">
              <span className={`status-pill small ${ticketDirty ? "warning" : "success"}`}>
                {ticketDirty ? "Active ticket" : "Clean slate"}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetTicket}
                disabled={!ticketDirty}
              >
                Start New Ticket
              </button>
            </div>
          </div>

          <div className="pos-reference-summary-fields">
            <div className="pos-reference-customer-field">
              <input
                className="input"
                type="text"
                placeholder="Find or add customer"
                value={checkout.customer}
                onChange={(event) =>
                  setCheckout((state) => ({
                    ...state,
                    customer: event.target.value,
                    customerId:
                      state.customerId &&
                      String(state.customer || "").trim() !== String(event.target.value || "").trim()
                        ? null
                        : state.customerId,
                  }))
                }
              />

              {selectedCustomer ? (
                <div className="pos-reference-customer-record">
                  <div className="pos-reference-customer-record-main">
                    <div>
                      <strong>{selectedCustomer.name}</strong>
                      <small>
                        {selectedCustomer.customerNumber || "No customer number"} |{" "}
                        {selectedCustomer.loyaltyNumber || "No loyalty number"}
                      </small>
                    </div>
                    <div className="pos-reference-customer-badges">
                      <span className="status-pill neutral">{selectedCustomer.loyaltyTier || "Guest"}</span>
                      <span
                        className={`status-pill ${
                          selectedCustomer.discountEligible ? "success" : "warning"
                        }`}
                      >
                        {selectedCustomer.discountEligible
                          ? `${selectedCustomer.discountPercent || 0}% live`
                          : "Discount locked"}
                      </span>
                    </div>
                  </div>
                  <div className="pos-reference-customer-record-meta">
                    <small>
                      {selectedCustomer.phone || selectedCustomer.email || "No contact recorded"} |{" "}
                      {selectedCustomer.loyaltyStatus || "Profile status unavailable"}
                    </small>
                    <div className="pos-reference-customer-record-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => navigate(`/customers/${selectedCustomer.id}`)}
                      >
                        <FiAddressCard />
                        View record
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() =>
                          setCheckout((state) => ({
                            ...state,
                            customer: "Walk-in Customer",
                            customerId: null,
                          }))
                        }
                      >
                        Walk-in
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {!selectedCustomer && customerSuggestions.length ? (
                <div className="pos-reference-customer-suggestions">
                  {customerSuggestions.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      className="pos-reference-customer-suggestion"
                      onClick={() =>
                        setCheckout((state) => ({
                          ...state,
                          customer: customer.name,
                          customerId: customer.id,
                        }))
                      }
                    >
                      <div>
                        <strong>{customer.name}</strong>
                        <small>
                          {customer.customerNumber || "No number"} |{" "}
                          {customer.phone || customer.email || "No contact recorded"}
                        </small>
                      </div>
                      <span
                        className={`status-pill small ${
                          customer.discountEligible ? "success" : "neutral"
                        }`}
                      >
                        {customer.discountEligible
                          ? `${customer.discountPercent || 0}% ${customer.loyaltyTier || "Member"}`
                          : customer.loyaltyTier || "Guest"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {canCreateCustomerRecord ? (
                <div className="pos-reference-customer-create">
                  <small>No saved customer matches this entry yet.</small>
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    onClick={() =>
                      navigate("/customers/new", {
                        state: {
                          prefillCustomerDraft: {
                            name: checkout.customer,
                            loyaltyOptIn: true,
                            preferredContactMethod:
                              normalizedCustomerSearchValue.includes("@") ? "Email" : "Phone",
                            email: normalizedCustomerSearchValue.includes("@") ? normalizedCustomerSearchValue : "",
                            phone:
                              !normalizedCustomerSearchValue.includes("@") &&
                              /[0-9()+\-\s]{7,}/.test(normalizedCustomerSearchValue)
                                ? normalizedCustomerSearchValue
                                : "",
                          },
                          assistantActionLabel: "Create customer profile",
                          assistantActionNote:
                            "Capture this shopper now so future checkouts can apply loyalty pricing and named history.",
                        },
                      })
                    }
                  >
                    <FiUserPlus />
                    Create loyalty customer
                  </button>
                </div>
              ) : null}
            </div>

            {advancedOpen ? (
              <div id="pos-advanced-checkout" className="pos-reference-advanced-grid">
                <select
                  className="input"
                  value={checkout.paymentMethod}
                  onChange={(event) => setCheckout((state) => ({ ...state, paymentMethod: event.target.value }))}
                >
                  <option>Card</option>
                  <option>Cash</option>
                  <option>Transfer</option>
                  <option>Mobile Money</option>
                  <option>Other</option>
                </select>
                <select
                  className="input"
                  value={checkout.channel}
                  onChange={(event) => setCheckout((state) => ({ ...state, channel: event.target.value }))}
                >
                  <option>In-Store</option>
                  <option>Online</option>
                  <option>Delivery</option>
                  <option>Pickup</option>
                </select>
                <select
                  className="input pos-reference-advanced-grid__full"
                  value={checkout.status}
                  onChange={(event) => setCheckout((state) => ({ ...state, status: event.target.value }))}
                >
                  <option>Paid</option>
                  <option>Pending</option>
                </select>
              </div>
            ) : null}
          </div>

          <div className="pos-reference-order-list">
            {cart.length ? (
              cart.map((line) => (
                <PosCartRowPremium
                  key={line.productId}
                  line={line}
                  currency={currency}
                  customerDiscountPercent={activeCustomerDiscountPercent}
                  onIncrease={() => updateLineQty(line.productId, line.qty + 1)}
                  onDecrease={() =>
                    line.qty <= 1 ? removeCartLine(line.productId) : updateLineQty(line.productId, line.qty - 1)
                  }
                  onRemove={() => removeCartLine(line.productId)}
                />
              ))
            ) : (
              <div className="pos-reference-empty">
                <strong>Start with the catalog.</strong>
                <p>Add products from the live backend catalog to build the next sale.</p>
              </div>
            )}
          </div>

            <div className="pos-reference-totals">
              {estimatedDiscount > 0 ? (
                <div>
                  <span>Loyalty discount</span>
                  <strong>-{formatMoney(currency, estimatedDiscount)}</strong>
                </div>
              ) : null}
              <div>
                <span>Subtotal</span>
                <strong>{formatMoney(currency, estimatedSubtotal)}</strong>
              </div>
              <div>
                <span>{taxLineLabel}</span>
                <strong>{formatMoney(currency, estimatedTax)}</strong>
              </div>
            <div>
              <span>Tax mode</span>
              <strong>{basketTaxMode}</strong>
            </div>
            <div className="is-total">
              <span>Total</span>
              <strong>{formatMoney(currency, estimatedTotal)}</strong>
            </div>
          </div>

          <div
            className={`pos-reference-tax-callout${
              taxSummary.taxableLines ? " is-taxable" : " is-zero-rated"
            }`}
          >
            <strong>
              {taxSummary.taxableLines
                ? `${formatMoney(currency, taxSummary.taxableSubtotal)} taxable subtotal`
                : "Zero-rated grocery basket"}
            </strong>
            <small>{taxSummaryCopy}</small>
            {taxSummaryExamples ? <small className="pos-reference-tax-example">{taxSummaryExamples}</small> : null}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-full pos-reference-submit"
            onClick={submitSale}
            disabled={!cart.length || submitting}
          >
            {submitting ? "Posting Sale..." : "Collect Payment"}
          </button>

          {latestTicket ? (
            <div className="pos-reference-receipt-card">
              <div className="pos-reference-receipt-copy">
                <span className="reference-page-kicker">Last receipt</span>
                <strong>{latestTicket?.id || "Latest sale"}</strong>
                <small>
                  {latestTicket?.customer || "Walk-in Customer"} / {formatDate(latestTicket?.date || latestTicket?.createdAt)}
                </small>
              </div>
              <div className="pos-reference-receipt-actions">
                <span className="status-pill small neutral">{formatMoney(currency, latestTicket?.total)}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={printLatestReceipt}
                >
                  Print Receipt
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className="btn btn-secondary btn-full"
            onClick={resetTicket}
            disabled={!ticketDirty}
          >
            Start New Ticket
          </button>
        </aside>
      </section>
    </div>
  );
}

export default POS;

