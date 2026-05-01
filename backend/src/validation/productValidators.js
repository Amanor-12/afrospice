const {
  ensureObject,
  readRequiredString,
  readOptionalString,
  readPositiveNumber,
  readNonNegativeNumber,
  readNonNegativeInteger,
  readPositiveInteger,
  throwValidationError,
} = require("./helpers");
const { VALID_PRODUCT_TAX_CLASSES } = require("../tax/ontarioProductTax");

function readOptionalProductImage(value) {
  const imageUrl = readOptionalString(value, {
    label: "Product image",
    maxLength: 3000000,
    defaultValue: "",
  });

  if (!imageUrl) {
    return "";
  }

  if (/^data:image\//i.test(imageUrl)) {
    return imageUrl;
  }

  if (/^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("/")) {
    return imageUrl;
  }

  throwValidationError("Product image must be a valid image URL or uploaded image.");
}

function validateProductPayload(payload) {
  const body = ensureObject(payload);
  const hasTaxClass = Object.prototype.hasOwnProperty.call(body, "taxClass");
  const taxClass = hasTaxClass
    ? readOptionalString(body.taxClass, {
        label: "Tax class",
        maxLength: 48,
        transform: (value) => value.toUpperCase(),
      })
    : undefined;

  if (taxClass && !VALID_PRODUCT_TAX_CLASSES.includes(taxClass)) {
    throwValidationError(`Tax class must be one of: ${VALID_PRODUCT_TAX_CLASSES.join(", ")}.`);
  }

  return {
    name: readRequiredString(body.name, "Product name", {
      maxLength: 120,
    }),
    sku: readRequiredString(body.sku, "SKU", {
      maxLength: 64,
      transform: (value) => value.toUpperCase(),
    }),
    barcode: readOptionalString(body.barcode, {
      label: "Barcode",
      maxLength: 64,
    }),
    imageUrl: readOptionalProductImage(body.imageUrl),
    price: readPositiveNumber(body.price, "Price"),
    unitCost: readNonNegativeNumber(body.unitCost ?? 0, "Unit cost"),
    stock: readNonNegativeInteger(body.stock ?? 0, "Stock quantity"),
    unitLabel: readOptionalString(body.unitLabel, {
      label: "Unit label",
      maxLength: 24,
      defaultValue: "",
    }),
    casePack: readNonNegativeInteger(body.casePack ?? 0, "Case pack"),
    reorderPoint: readNonNegativeInteger(body.reorderPoint ?? 0, "Reorder point"),
    parLevel: readNonNegativeInteger(body.parLevel ?? 0, "Par level"),
    shelfLocation: readOptionalString(body.shelfLocation, {
      label: "Shelf location",
      maxLength: 48,
      defaultValue: "",
    }),
    receivingNotes: readOptionalString(body.receivingNotes, {
      label: "Receiving notes",
      maxLength: 240,
      defaultValue: "",
    }),
    category: readRequiredString(body.category, "Category", {
      maxLength: 80,
    }),
    supplier: readOptionalString(body.supplier, {
      label: "Supplier",
      maxLength: 120,
      defaultValue: "",
    }),
    ...(hasTaxClass ? { taxClass } : {}),
  };
}

function validateRestockPayload(payload) {
  const body = ensureObject(payload);

  return {
    amount: readPositiveInteger(body.amount, "Restock amount"),
    note: readOptionalString(body.note, {
      label: "Restock note",
      maxLength: 240,
      defaultValue: "",
    }),
  };
}

module.exports = {
  validateProductPayload,
  validateRestockPayload,
};
