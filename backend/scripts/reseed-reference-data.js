require("../src/config/loadEnv");

const runtime = require("../src/config/runtime");
const { connectDB, disconnectDB } = require("../src/config/db");
const storeRuntime = require("../src/data/storeRuntime");
const models = require("../src/data/models");

const CONFIRMATION_TOKEN = "YES";
const confirmationValue = String(process.env.CONFIRM_RESET_REFERENCE_DATA || "").trim().toUpperCase();

const BUSINESS_COLLECTIONS = [
  models.InventoryMovement,
  models.Sale,
  models.PurchaseOrder,
  models.CycleCount,
  models.Product,
  models.Supplier,
  models.Customer,
  models.User,
  models.UserAccessEvent,
  models.UserSession,
  models.UserSavedView,
  models.AuditLog,
  models.EmailLog,
  models.CustomerCommunicationLog,
  models.NotificationReceipt,
  models.UserPasskey,
];

const COUNTER_KEYS = [
  "supplier_id",
  "customer_id",
  "product_id",
  "user_id",
  "sale_id",
  "inventory_movement_id",
  "purchase_order_id",
  "cycle_count_id",
  "user_access_event_id",
  "user_saved_view_id",
  "audit_log_id",
];

async function main() {
  if (confirmationValue !== CONFIRMATION_TOKEN) {
    throw new Error(
      `Reference reseed is destructive. Re-run with CONFIRM_RESET_REFERENCE_DATA=${CONFIRMATION_TOKEN} to continue.`
    );
  }

  runtime.assertRuntimeConfig();
  await connectDB();

  for (const collection of BUSINESS_COLLECTIONS) {
    await collection.deleteMany({});
  }

  await models.Counter.deleteMany({
    key: { $in: COUNTER_KEYS },
  });

  const result = await storeRuntime.bootstrapSeedData({
    onlyIfEmpty: false,
  });

  await storeRuntime.refreshCache();
  const storage = storeRuntime.getStorageInfo();

  console.log("Reference data reseed complete.");
  console.log(
    JSON.stringify(
      {
        result,
        mongoUri: runtime.mongoUri,
        counts: storage.counts,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Reference data reseed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await disconnectDB();
    } catch (error) {
      console.error("Mongo disconnect failed:", error);
      process.exitCode = 1;
    }
  });
