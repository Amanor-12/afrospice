import heroImage from "../../../assets/hero.png";
import { resolveProductImage } from "./productMedia";

const KEYWORD_TONES = [
  {
    match: [
      "water",
      "juice",
      "coke",
      "drink",
      "bottle",
      "leaf",
      "herb",
      "curry",
      "uziza",
      "oha",
      "ugu",
      "efirin",
      "ewedu",
      "utazi",
      "spinach",
      "cassava leaf",
      "malt",
      "vitamalt",
    ],
    tone: "fresh",
  },
  {
    match: [
      "bread",
      "pie",
      "bakery",
      "snack",
      "milo",
      "tigernut",
      "choco",
      "chin",
      "chips",
      "candy",
      "mint",
      "shortbread",
      "ground nut",
      "cashew",
    ],
    tone: "warm",
  },
  {
    match: ["fish", "turkey", "periwinkle", "frozen", "seafood", "protein", "catfish", "stock fish", "ponmo"],
    tone: "sun",
  },
  {
    match: [
      "rice",
      "flour",
      "salt",
      "powder",
      "oil",
      "spice",
      "paste",
      "mix",
      "sugar",
      "garri",
      "lafu",
      "yam",
      "cassava",
      "cocoyam",
      "banga",
      "ogiri",
      "ogi",
      "custard",
      "beans",
      "noodles",
      "akpu",
      "poundo",
    ],
    tone: "gold",
  },
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function findTone(product = {}) {
  const searchText = [product?.name, product?.category, product?.supplier, product?.sku]
    .map(normalizeText)
    .join(" ");

  return (
    KEYWORD_TONES.find((rule) => rule.match.some((needle) => searchText.includes(needle)))?.tone ||
    "brand"
  );
}

export function getProductVisual(product = {}) {
  const image = resolveProductImage(product) || heroImage;
  const tone = findTone(product);

  return {
    image,
    tone,
    alt: `${String(product?.name || "Product")} visual`,
  };
}

export default getProductVisual;
