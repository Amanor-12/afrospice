import basmatiRice5kg from "../../../assets/products/basmati-rice5kg.webp";
import beefStrips from "../../../assets/products/beef-strips.webp";
import bottledWater from "../../../assets/products/bottled water.webp";
import breadLoaf from "../../../assets/products/Bread Loaf.webp";
import butterSpread from "../../../assets/products/butter-spread.webp";
import cassavaFlour from "../../../assets/products/cassava-flour.webp";
import cokePack from "../../../assets/products/coke-pack.webp";
import cookingSalt from "../../../assets/products/cooking salt.webp";
import eggTray from "../../../assets/products/egg-tray.webp";
import frozenChicken from "../../../assets/products/frozen-chicken.webp";
import groundnutMix from "../../../assets/products/groundnut-mix.webp";
import jollofMix from "../../../assets/products/jollof-mix.webp";
import meatPiePack from "../../../assets/products/meatpie-pack.webp";
import milkPowder from "../../../assets/products/milk-powder.webp";
import miloTin from "../../../assets/products/milo-tin.webp";
import orangeJuice from "../../../assets/products/orange-juice.webp";
import palmOil from "../../../assets/products/palm-iol.webp";
import peanutButter from "../../../assets/products/peanut-butter.webp";
import plantainChips from "../../../assets/products/plantain-chips.webp";
import semolinaFlour from "../../../assets/products/semolina-flour.webp";
import sugar from "../../../assets/products/sugar.webp";
import tomatoPaste from "../../../assets/products/tomato-paste.webp";

function normalizeProductKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeDirectImageSource(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^data:image\//i.test(normalized)) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) return normalized;
  return "";
}

const PRODUCT_IMAGE_BY_KEY = new Map([
  ["jollofricemix", jollofMix],
  ["skufood001", jollofMix],
  ["curryleaf", jollofMix],
  ["afrhrb015", jollofMix],
  ["palmoil", palmOil],
  ["skucook002", palmOil],
  ["palmnutcreambanga", tomatoPaste],
  ["afrpan004", tomatoPaste],
  ["basmatirice5kg", basmatiRice5kg],
  ["skufood003", basmatiRice5kg],
  ["boxofmackerelfishtitusfish", frozenChicken],
  ["afrfrz008", frozenChicken],
  ["semolinaflour", semolinaFlour],
  ["skufood004", semolinaFlour],
  ["yamflour", semolinaFlour],
  ["cocoyampowderede", semolinaFlour],
  ["yellowgarri", cassavaFlour],
  ["whitegarri", cassavaFlour],
  ["oatfufu", semolinaFlour],
  ["riceflour", semolinaFlour],
  ["beansflour1kg", basmatiRice5kg],
  ["cassavafufuakpu", cassavaFlour],
  ["olaolapoundedyam", semolinaFlour],
  ["ayoolapoundoyam", semolinaFlour],
  ["afrflr003", semolinaFlour],
  ["afrflr014", semolinaFlour],
  ["cassavaflour", cassavaFlour],
  ["skufood005", cassavaFlour],
  ["coconutgarri", cassavaFlour],
  ["lafucassavaflour", cassavaFlour],
  ["cocoyamfufumamaschoice", cassavaFlour],
  ["afrflr001", cassavaFlour],
  ["afrflr002", cassavaFlour],
  ["afrflr013", cassavaFlour],
  ["tomatopaste", tomatoPaste],
  ["skugroc006", tomatoPaste],
  ["ogiri", tomatoPaste],
  ["ewaoloyinhoneybeans", basmatiRice5kg],
  ["stockfishbonedandboneless", frozenChicken],
  ["afrpan005", tomatoPaste],
  ["cookingsalt", cookingSalt],
  ["suyaspices", cookingSalt],
  ["groundpepper", cookingSalt],
  ["skugroc007", cookingSalt],
  ["sugar2kg", sugar],
  ["skugroc008", sugar],
  ["peanutbutter", peanutButter],
  ["skugroc009", peanutButter],
  ["cokepack", cokePack],
  ["skudrnk010", cokePack],
  ["bottledwater24pk", bottledWater],
  ["skudrnk011", bottledWater],
  ["orangejuice", orangeJuice],
  ["skudrnk012", orangeJuice],
  ["milotin", miloTin],
  ["peakevaporatedmilk410gtin", milkPowder],
  ["peakmilk", milkPowder],
  ["grandiospapogi", milkPowder],
  ["ladybcustard", milkPowder],
  ["vitamaltmaltdrink", orangeJuice],
  ["skudrnk013", miloTin],
  ["milkpowder", milkPowder],
  ["skudair014", milkPowder],
  ["chocomilo", miloTin],
  ["afrsnk011", miloTin],
  ["butterspread", butterSpread],
  ["skudair015", butterSpread],
  ["eggtray", eggTray],
  ["skudair016", eggTray],
  ["breadloaf", breadLoaf],
  ["agegebread", breadLoaf],
  ["skubake017", breadLoaf],
  ["meatpiepack", meatPiePack],
  ["skubake018", meatPiePack],
  ["indomieinstantnoodles", jollofMix],
  ["plantainchips", plantainChips],
  ["mrjohnplantainchips", plantainChips],
  ["skusnck019", plantainChips],
  ["groundnutmix", groundnutMix],
  ["ttchinchin", plantainChips],
  ["groundnut", groundnutMix],
  ["cashewsnut", groundnutMix],
  ["mcvitiesshortbread", plantainChips],
  ["royaltyshortbreadfingers", plantainChips],
  ["buttermintscandy", plantainChips],
  ["tomtomcandy", plantainChips],
  ["skusnck020", groundnutMix],
  ["tigernut", groundnutMix],
  ["afrsnk012", groundnutMix],
  ["frozenchicken", frozenChicken],
  ["skumeat021", frozenChicken],
  ["smokedfrozenturkey", frozenChicken],
  ["smokedcatfish", frozenChicken],
  ["cowskinponmo", beefStrips],
  ["afrfrz009", frozenChicken],
  ["beefstrips", beefStrips],
  ["skumeat022", beefStrips],
  ["periwinkles", beefStrips],
  ["cassavaleaffrozen", jollofMix],
  ["frozenspinach2lb", jollofMix],
  ["afrfrz010", beefStrips],
  ["ohaleafdried", jollofMix],
  ["uzizaleaf", jollofMix],
  ["uguleafdried", jollofMix],
  ["scentedleafefirin", jollofMix],
  ["juteleavesewedu", jollofMix],
  ["utazileafdried", jollofMix],
  ["afrhrb006", jollofMix],
  ["afrhrb007", jollofMix],
]);

export function resolveProductImage(product = {}) {
  const directImage = normalizeDirectImageSource(product?.imageUrl || product?.image || product?.photo);
  if (directImage) {
    return directImage;
  }

  const candidates = [product?.name, product?.sku, product?.barcode]
    .map(normalizeProductKey)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (PRODUCT_IMAGE_BY_KEY.has(candidate)) {
      return PRODUCT_IMAGE_BY_KEY.get(candidate);
    }
  }

  for (const candidate of candidates) {
    for (const [key, image] of PRODUCT_IMAGE_BY_KEY.entries()) {
      if (candidate.includes(key) || key.includes(candidate)) {
        return image;
      }
    }
  }

  return null;
}
