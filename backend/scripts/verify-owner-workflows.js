require("../src/config/loadEnv");

process.env.ALLOWED_HOSTS = [
  String(process.env.ALLOWED_HOSTS || "").trim(),
  "127.0.0.1",
  "localhost",
]
  .filter(Boolean)
  .join(",");

function buildVerificationMongoUri(rawUri) {
  const candidate = String(rawUri || "").trim();
  if (!candidate) {
    throw new Error("MONGO_URI must be configured before owner workflow verification runs.");
  }

  const parsed = new URL(candidate);
  const baseName = String(parsed.pathname || "").replace(/^\/+/, "").trim() || "afrospice";
  const verificationDatabase = `${baseName}_owner_verify_${Date.now()}`;
  parsed.pathname = `/${verificationDatabase}`;

  return {
    uri: parsed.toString(),
    databaseName: verificationDatabase,
  };
}

const verificationMongo = buildVerificationMongoUri(process.env.MONGO_URI);
process.env.MONGO_URI = verificationMongo.uri;

const http = require("http");

const runtime = require("../src/config/runtime");
const { disconnectDB, mongoose } = require("../src/config/db");
const { stopDailySummaryJob } = require("../src/jobs/dailySummaryJob");
const storeRuntime = require("../src/data/storeRuntime");
const app = require("../src/app");

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printKeyValue(key, value) {
  console.log(`${key}: ${value}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSetCookieHeader(value = "") {
  const firstSegment = String(value || "").split(";")[0].trim();
  const separatorIndex = firstSegment.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  return {
    name: firstSegment.slice(0, separatorIndex).trim(),
    value: firstSegment.slice(separatorIndex + 1).trim(),
  };
}

function mergeResponseCookies(cookieJar, response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);

  setCookies.forEach((entry) => {
    const parsed = parseSetCookieHeader(entry);
    if (!parsed?.name) {
      return;
    }

    cookieJar[parsed.name] = parsed.value;
  });
}

function buildCookieHeader(cookieJar) {
  return Object.entries(cookieJar)
    .filter(([, value]) => String(value || "").trim())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function requestJson(baseUrl, path, options = {}) {
  const cookieJar = options.cookieJar || null;
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (cookieJar) {
    const cookieHeader = buildCookieHeader(cookieJar);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (cookieJar) {
    mergeResponseCookies(cookieJar, response);
  }

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    json,
    text,
  };
}

async function requestInvalidHost(port) {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/system/health",
        method: "GET",
        headers: {
          Host: "malicious.example.com",
          Accept: "application/json",
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = null;
          }

          resolve({
            status: res.statusCode || 0,
            json,
            text: body,
          });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function summarizeCollection(data, key) {
  if (Array.isArray(data)) {
    return data.length;
  }

  if (Array.isArray(data?.[key])) {
    return data[key].length;
  }

  return 0;
}

function extractCollection(data, key) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.[key])) {
    return data[key];
  }

  return [];
}

async function startServer() {
  runtime.assertRuntimeConfig();
  await app.initialize();
  await storeRuntime.bootstrapSeedData({
    onlyIfEmpty: false,
  });
  await storeRuntime.refreshCache();

  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: address?.port,
      });
    });

    server.on("error", reject);
  });
}

async function run() {
  const cookieJar = {};
  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  const uniqueToken = Date.now();

  try {
    printSection("Owner Workflow Route E2E");
    printKeyValue("baseUrl", baseUrl);
    printKeyValue("hostValidationEnabled", runtime.hostValidationEnabled ? "yes" : "no");
    printKeyValue("verificationDatabase", verificationMongo.databaseName);

    const health = await requestJson(baseUrl, "/api/system/health");
    assert(health.ok, `Health check failed (${health.status}).`);
    assert(health.json?.data?.status === "ok", "Health payload did not return ok status.");

    const unauthenticatedSales = await requestJson(baseUrl, "/api/sales");
    assert(
      unauthenticatedSales.status === 401,
      `Unauthenticated route access did not return 401 (${unauthenticatedSales.status}).`
    );

    const login = await requestJson(baseUrl, "/api/auth/login", {
      method: "POST",
      body: { pin: "7700" },
      cookieJar,
    });
    assert(login.ok, `Owner login failed (${login.status}).`);
    assert(cookieJar[runtime.authCookieName], "Owner login did not set the auth cookie.");

    const me = await requestJson(baseUrl, "/api/auth/me", {
      cookieJar,
    });
    assert(me.ok, `Authenticated owner lookup failed (${me.status}).`);
    assert(me.json?.data?.user?.staffId === "ADMIN001", "Authenticated owner was not ADMIN001.");

    const notifications = await requestJson(baseUrl, "/api/reports/notifications", {
      cookieJar,
    });
    assert(notifications.ok, `Notifications route failed (${notifications.status}).`);

    const assistantBootstrap = await requestJson(baseUrl, "/api/reports/owner-assistant", {
      cookieJar,
    });
    assert(
      assistantBootstrap.ok,
      `Owner assistant bootstrap failed (${assistantBootstrap.status}).`
    );

    const assistantReply = await requestJson(baseUrl, "/api/reports/owner-assistant", {
      method: "POST",
      body: {
        question: "What needs my attention right now?",
        history: [],
      },
      cookieJar,
    });
    assert(assistantReply.ok, `Owner assistant reply failed (${assistantReply.status}).`);
    assert(
      String(assistantReply.json?.data?.answer || "").trim(),
      "Owner assistant reply did not include an answer."
    );

    const customerCommunications = await requestJson(
      baseUrl,
      "/api/settings/customer-communications",
      {
        cookieJar,
      }
    );
    assert(
      customerCommunications.ok,
      `Customer communications overview failed (${customerCommunications.status}).`
    );

    const dailySummaryPreview = await requestJson(baseUrl, "/api/settings/daily-summary/preview", {
      cookieJar,
    });
    assert(
      dailySummaryPreview.ok,
      `Daily summary preview failed (${dailySummaryPreview.status}).`
    );

    const products = await requestJson(baseUrl, "/api/products", {
      cookieJar,
    });
    assert(products.ok, `Products route failed (${products.status}).`);
    const productRows = extractCollection(products.json?.data, "products");
    const targetProduct =
      productRows.find((product) => Number(product?.stock || 0) > 0) || productRows[0] || null;
    assert(targetProduct?.id, "No product was available for owner route e2e checks.");

    const suppliers = await requestJson(baseUrl, "/api/suppliers", {
      cookieJar,
    });
    assert(suppliers.ok, `Suppliers route failed (${suppliers.status}).`);

    const purchaseOrders = await requestJson(baseUrl, "/api/purchase-orders", {
      cookieJar,
    });
    assert(purchaseOrders.ok, `Purchase orders route failed (${purchaseOrders.status}).`);

    const sales = await requestJson(baseUrl, "/api/sales", {
      cookieJar,
    });
    assert(sales.ok, `Sales route failed (${sales.status}).`);

    const advancedReports = await requestJson(baseUrl, "/api/reports?range=monthly", {
      cookieJar,
    });
    assert(advancedReports.ok, `Advanced reports route failed (${advancedReports.status}).`);

    const createdSupplier = await requestJson(baseUrl, "/api/suppliers", {
      method: "POST",
      body: {
        name: `E2E Supply Lane ${uniqueToken}`,
        contactName: "Ops Control",
        email: `ops-${uniqueToken}@example.com`,
        phone: "4160000000",
        notes: "Route-level owner e2e supplier creation check.",
        isActive: true,
      },
      cookieJar,
    });
    assert(createdSupplier.status === 201, `Supplier creation failed (${createdSupplier.status}).`);
    const supplierId = Number(createdSupplier.json?.data?.id || 0);
    const supplierName = String(createdSupplier.json?.data?.name || "").trim();
    assert(supplierId > 0, "Supplier creation did not return a valid supplier id.");
    assert(supplierName, "Supplier creation did not return a valid supplier name.");

    const createdPurchaseOrder = await requestJson(baseUrl, "/api/purchase-orders", {
      method: "POST",
      body: {
        supplier: supplierName,
        priority: "Standard",
        note: "Owner e2e purchase order creation check.",
        items: [
          {
            productId: targetProduct.id,
            qtyOrdered: 2,
            unitCost: Number(targetProduct.unitCost || targetProduct.price || 1),
          },
        ],
      },
      cookieJar,
    });
    assert(
      createdPurchaseOrder.status === 201,
      `Purchase order creation failed (${createdPurchaseOrder.status}).`
    );
    const purchaseOrderId = String(createdPurchaseOrder.json?.data?.id || "").trim();
    assert(purchaseOrderId, "Purchase order creation did not return an order id.");

    const purchaseOrderSent = await requestJson(
      baseUrl,
      `/api/purchase-orders/${purchaseOrderId}/status`,
      {
        method: "PATCH",
        body: {
          status: "Sent",
        },
        cookieJar,
      }
    );
    assert(
      purchaseOrderSent.ok,
      `Purchase order status transition failed (${purchaseOrderSent.status}).`
    );
    assert(
      String(purchaseOrderSent.json?.data?.status || "").trim() === "Sent",
      "Purchase order did not transition to Sent."
    );

    const purchaseOrderReceived = await requestJson(
      baseUrl,
      `/api/purchase-orders/${purchaseOrderId}/receive`,
      {
        method: "POST",
        body: {
          note: "Owner e2e receive check.",
          items: [
            {
              productId: targetProduct.id,
              qtyReceived: 1,
            },
          ],
        },
        cookieJar,
      }
    );
    assert(
      purchaseOrderReceived.ok,
      `Purchase order receive failed (${purchaseOrderReceived.status}).`
    );
    assert(
      Number(purchaseOrderReceived.json?.data?.unitsReceived || 0) >= 1,
      "Purchase order receive did not update unitsReceived."
    );

    const createdCustomer = await requestJson(baseUrl, "/api/customers", {
      method: "POST",
      body: {
        name: `Owner Workflow ${uniqueToken}`,
        email: `owner-workflow-${uniqueToken}@example.com`,
        phone: "4165551000",
        notes: "Owner e2e loyalty enrollment verification.",
        loyaltyOptIn: true,
        marketingOptIn: true,
        preferredContactMethod: "Email",
      },
      cookieJar,
    });
    assert(createdCustomer.status === 201, `Customer creation failed (${createdCustomer.status}).`);
    const customerId = Number(createdCustomer.json?.data?.id || 0);
    assert(customerId > 0, "Customer creation did not return a valid customer id.");

    const customerComms = await requestJson(baseUrl, `/api/customers/${customerId}/communications`, {
      cookieJar,
    });
    assert(customerComms.ok, `Customer communications failed (${customerComms.status}).`);

    const createdSale = await requestJson(baseUrl, "/api/sales", {
      method: "POST",
      body: {
        customerId,
        customer: String(createdCustomer.json?.data?.name || ""),
        channel: "In-Store",
        paymentMethod: "Card",
        status: "Paid",
        items: [
          {
            productId: targetProduct.id,
            qty: 1,
          },
        ],
      },
      cookieJar,
    });
    assert(createdSale.status === 201, `Sale creation failed (${createdSale.status}).`);
    const saleId = String(createdSale.json?.data?.id || "").trim();
    assert(saleId, "Sale creation did not return a valid sale id.");

    const refundRequest = await requestJson(
      baseUrl,
      `/api/sales/${encodeURIComponent(saleId)}/refund-request`,
      {
        method: "POST",
        body: {
          reason: "Damaged seal on delivery",
          note: "Owner e2e refund request check.",
          incidentReport: "Customer reported damaged packaging and requested a refund at checkout.",
          customerStatement: "Requested immediate reversal of charge.",
        },
        cookieJar,
      }
    );
    assert(refundRequest.ok, `Refund request failed (${refundRequest.status}).`);
    assert(
      String(refundRequest.json?.data?.refundRequest?.status || "").trim() === "Pending",
      "Refund request did not enter pending state."
    );

    const refundDecision = await requestJson(
      baseUrl,
      `/api/sales/${encodeURIComponent(saleId)}/refund-request/decision`,
      {
        method: "POST",
        body: {
          decision: "Rejected",
          decisionNote: "Rejected after reviewing the returned goods quality report.",
        },
        cookieJar,
      }
    );
    assert(refundDecision.ok, `Refund decision failed (${refundDecision.status}).`);
    assert(
      String(refundDecision.json?.data?.refundRequest?.status || "").trim() === "Rejected",
      "Refund decision did not update the refund request to Rejected."
    );

    const notificationItems = Array.isArray(notifications.json?.data?.items)
      ? notifications.json.data.items
      : [];
    if (notificationItems.length > 0) {
      const acknowledgeNotification = await requestJson(
        baseUrl,
        "/api/reports/notifications/acknowledge",
        {
          method: "POST",
          body: {
            ids: [notificationItems[0].id],
          },
          cookieJar,
        }
      );
      assert(
        acknowledgeNotification.ok,
        `Notification acknowledgement failed (${acknowledgeNotification.status}).`
      );
    }

    const invalidHost = await requestInvalidHost(port);
    assert(invalidHost.status === 400, `Invalid host request did not fail as expected (${invalidHost.status}).`);
    assert(
      invalidHost.json?.code === "HOST_NOT_ALLOWED",
      "Invalid host request did not return HOST_NOT_ALLOWED."
    );

    printSection("Verified Flows");
    printKeyValue("owner", me.json?.data?.user?.fullName || "n/a");
    printKeyValue(
      "notifications",
      Number(notifications.json?.data?.items?.length || 0)
    );
    printKeyValue(
      "assistantFollowUps",
      Number(
        assistantBootstrap.json?.data?.followUps?.length ||
          assistantBootstrap.json?.data?.suggestedQuestions?.length ||
          0
      )
    );
    printKeyValue(
      "products",
      summarizeCollection(products.json?.data, "products")
    );
    printKeyValue(
      "suppliers",
      summarizeCollection(suppliers.json?.data, "suppliers")
    );
    printKeyValue(
      "purchaseOrders",
      summarizeCollection(purchaseOrders.json?.data, "purchaseOrders")
    );
    printKeyValue(
      "sales",
      summarizeCollection(sales.json?.data, "sales")
    );
    printKeyValue(
      "deliverableCustomers",
      Number(customerCommunications.json?.data?.coverage?.deliverableCustomers || 0)
    );
    printKeyValue("e2eSupplierId", supplierId);
    printKeyValue("e2ePurchaseOrderId", purchaseOrderId);
    printKeyValue("e2eCustomerId", customerId);
    printKeyValue("e2eSaleId", saleId);
    printKeyValue(
      "dailySummaryRecipient",
      dailySummaryPreview.json?.data?.recipientEmail || "n/a"
    );
    printKeyValue("hostValidation", "rejected unknown host");

    console.log("\nPASS: Owner route e2e workflows and host validation verified.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run()
  .catch((error) => {
    console.error("Owner workflow verification failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopDailySummaryJob();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
    }
    await disconnectDB().catch(() => {});
  });
