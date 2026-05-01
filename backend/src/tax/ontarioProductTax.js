const ONTARIO_HST_RATE = 13;

const TAX_CLASS_DEFINITIONS = Object.freeze({
  ZERO_RATED_GROCERY: {
    code: "CA-ON-GROCERY-ZERO",
    label: "Basic grocery",
    rate: 0,
  },
  HST_STANDARD: {
    code: "CA-ON-HST13",
    label: "Ontario HST",
    rate: ONTARIO_HST_RATE,
  },
  HST_SOFT_DRINK: {
    code: "CA-ON-HST13-SOFT-DRINK",
    label: "Taxable soft drink",
    rate: ONTARIO_HST_RATE,
  },
  HST_SNACK: {
    code: "CA-ON-HST13-SNACK",
    label: "Taxable snack food",
    rate: ONTARIO_HST_RATE,
  },
  HST_PREPARED_FOOD: {
    code: "CA-ON-HST13-PREPARED",
    label: "Taxable prepared food",
    rate: ONTARIO_HST_RATE,
  },
});

const VALID_PRODUCT_TAX_CLASSES = Object.freeze(Object.keys(TAX_CLASS_DEFINITIONS));

function normalizeLookup(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const PRODUCT_TAX_CLASS_OVERRIDES = new Map([
  ["jollof rice mix", "ZERO_RATED_GROCERY"],
  ["palm oil", "ZERO_RATED_GROCERY"],
  ["basmati rice 5kg", "ZERO_RATED_GROCERY"],
  ["semolina flour", "ZERO_RATED_GROCERY"],
  ["cassava flour", "ZERO_RATED_GROCERY"],
  ["tomato paste", "ZERO_RATED_GROCERY"],
  ["cooking salt", "ZERO_RATED_GROCERY"],
  ["sugar 2kg", "ZERO_RATED_GROCERY"],
  ["peanut butter", "ZERO_RATED_GROCERY"],
  ["coke pack", "HST_SOFT_DRINK"],
  ["bottled water 24pk", "ZERO_RATED_GROCERY"],
  ["orange juice", "ZERO_RATED_GROCERY"],
  ["milo tin", "ZERO_RATED_GROCERY"],
  ["milk powder", "ZERO_RATED_GROCERY"],
  ["butter spread", "ZERO_RATED_GROCERY"],
  ["egg tray", "ZERO_RATED_GROCERY"],
  ["bread loaf", "ZERO_RATED_GROCERY"],
  ["meat pie pack", "HST_PREPARED_FOOD"],
  ["plantain chips", "HST_SNACK"],
  ["groundnut mix", "HST_SNACK"],
  ["frozen chicken", "ZERO_RATED_GROCERY"],
  ["beef strips", "ZERO_RATED_GROCERY"],
  ["coconut garri", "ZERO_RATED_GROCERY"],
  ["lafu (cassava flour)", "ZERO_RATED_GROCERY"],
  ["yam flour", "ZERO_RATED_GROCERY"],
  ["palmnut cream (banga)", "ZERO_RATED_GROCERY"],
  ["ogiri", "ZERO_RATED_GROCERY"],
  ["oha leaf (dried)", "ZERO_RATED_GROCERY"],
  ["uziza leaf", "ZERO_RATED_GROCERY"],
  ["box of mackerel fish (titus fish)", "ZERO_RATED_GROCERY"],
  ["smoked frozen turkey", "ZERO_RATED_GROCERY"],
  ["periwinkles", "ZERO_RATED_GROCERY"],
  ["choco-milo", "HST_SNACK"],
  ["tigernut", "HST_SNACK"],
  ["cocoyam fufu (mama's choice)", "ZERO_RATED_GROCERY"],
  ["cocoyam powder (ede)", "ZERO_RATED_GROCERY"],
  ["curry leaf", "ZERO_RATED_GROCERY"],
  ["yellow garri", "ZERO_RATED_GROCERY"],
  ["white garri", "ZERO_RATED_GROCERY"],
  ["oat fufu", "ZERO_RATED_GROCERY"],
  ["rice flour", "ZERO_RATED_GROCERY"],
  ["beans flour 1kg", "ZERO_RATED_GROCERY"],
  ["cassava fufu (akpu)", "ZERO_RATED_GROCERY"],
  ["ola-ola pounded yam", "ZERO_RATED_GROCERY"],
  ["ayoola poundo yam", "ZERO_RATED_GROCERY"],
  ["ewa oloyin (honey beans)", "ZERO_RATED_GROCERY"],
  ["peak evaporated milk 410g tin", "ZERO_RATED_GROCERY"],
  ["peak milk", "ZERO_RATED_GROCERY"],
  ["grandios pap (ogi)", "ZERO_RATED_GROCERY"],
  ["lady b custard", "ZERO_RATED_GROCERY"],
  ["agege bread", "ZERO_RATED_GROCERY"],
  ["indomie instant noodles", "ZERO_RATED_GROCERY"],
  ["suya spices", "ZERO_RATED_GROCERY"],
  ["ground pepper", "ZERO_RATED_GROCERY"],
  ["ugu leaf (dried)", "ZERO_RATED_GROCERY"],
  ["scented leaf (efirin)", "ZERO_RATED_GROCERY"],
  ["jute leaves (ewedu)", "ZERO_RATED_GROCERY"],
  ["utazi leaf (dried)", "ZERO_RATED_GROCERY"],
  ["cassava leaf (frozen)", "ZERO_RATED_GROCERY"],
  ["frozen spinach (2lb)", "ZERO_RATED_GROCERY"],
  ["smoked catfish", "ZERO_RATED_GROCERY"],
  ["stock fish (boned and boneless)", "ZERO_RATED_GROCERY"],
  ["cow skin (ponmo)", "ZERO_RATED_GROCERY"],
  ["tt chin-chin", "HST_SNACK"],
  ["mr. john plantain chips", "HST_SNACK"],
  ["ground nut", "HST_SNACK"],
  ["cashews nut", "HST_SNACK"],
  ["mcvities shortbread", "HST_SNACK"],
  ["royalty shortbread fingers", "HST_SNACK"],
  ["butter mints (candy)", "HST_SNACK"],
  ["tom tom (candy)", "HST_SNACK"],
  ["vitamalt malt drink", "HST_SOFT_DRINK"],
]);

const CATEGORY_TAX_CLASS_DEFAULTS = new Map([
  ["food staples", "ZERO_RATED_GROCERY"],
  ["cooking essentials", "ZERO_RATED_GROCERY"],
  ["groceries", "ZERO_RATED_GROCERY"],
  ["dairy", "ZERO_RATED_GROCERY"],
  ["bakery", "ZERO_RATED_GROCERY"],
  ["meat & protein", "ZERO_RATED_GROCERY"],
  ["snacks", "HST_SNACK"],
  ["drinks", "HST_SOFT_DRINK"],
  ["flour", "ZERO_RATED_GROCERY"],
  ["pantry", "ZERO_RATED_GROCERY"],
  ["breakfast", "ZERO_RATED_GROCERY"],
  ["bakery", "ZERO_RATED_GROCERY"],
  ["quick meal", "ZERO_RATED_GROCERY"],
  ["spices", "ZERO_RATED_GROCERY"],
  ["cooking herb", "ZERO_RATED_GROCERY"],
  ["frozen vegetable", "ZERO_RATED_GROCERY"],
  ["frozen seafood", "ZERO_RATED_GROCERY"],
  ["frozen protein", "ZERO_RATED_GROCERY"],
  ["beverage", "HST_SOFT_DRINK"],
]);

function isKnownProductTaxClass(value) {
  return VALID_PRODUCT_TAX_CLASSES.includes(String(value || "").trim());
}

function normalizeStoredTaxClass(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return isKnownProductTaxClass(normalized) ? normalized : "";
}

function deriveProductTaxClass(product = {}) {
  const manualTaxClass = normalizeStoredTaxClass(product.taxClass);
  if (manualTaxClass) return manualTaxClass;

  const explicitNameMatch = PRODUCT_TAX_CLASS_OVERRIDES.get(normalizeLookup(product.name));
  if (explicitNameMatch) return explicitNameMatch;

  const categoryMatch = CATEGORY_TAX_CLASS_DEFAULTS.get(normalizeLookup(product.category));
  if (categoryMatch) return categoryMatch;

  return "HST_STANDARD";
}

function getTaxDefinition(taxClass) {
  return TAX_CLASS_DEFINITIONS[deriveProductTaxClass({ taxClass })] || TAX_CLASS_DEFINITIONS.HST_STANDARD;
}

function getProductTaxProfile(product = {}) {
  const explicitTaxClass = normalizeStoredTaxClass(product.taxClass);
  const taxClass = deriveProductTaxClass(product);
  const definition = getTaxDefinition(taxClass);

  return {
    taxClass,
    taxCode: definition.code,
    taxLabel: definition.label,
    taxRate: Number(definition.rate || 0),
    isTaxable: Number(definition.rate || 0) > 0,
    taxSource: explicitTaxClass ? "manual" : "derived",
    taxClassOverride: explicitTaxClass,
  };
}

function calculateTaxAmount(amount, taxRate) {
  return Number(((Number(amount || 0) * Number(taxRate || 0)) / 100).toFixed(2));
}

module.exports = {
  ONTARIO_HST_RATE,
  TAX_CLASS_DEFINITIONS,
  VALID_PRODUCT_TAX_CLASSES,
  calculateTaxAmount,
  deriveProductTaxClass,
  getProductTaxProfile,
  isKnownProductTaxClass,
  normalizeStoredTaxClass,
};
