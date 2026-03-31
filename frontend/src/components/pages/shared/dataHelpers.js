export function getResponseData(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatMoney(currency, value) {
  return `${currency} ${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value, digits = 1) {
  return `${toNumber(value).toFixed(digits)}%`;
}

export function formatDate(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

export function firstArrayFrom(source, keys = []) {
  if (!source || typeof source !== "object") return [];

  for (const key of keys) {
    const candidate = source?.[key];
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

export function firstNumberFrom(source, keys = [], fallback = 0) {
  if (!source || typeof source !== "object") return fallback;

  for (const key of keys) {
    const candidate = Number(source?.[key]);
    if (Number.isFinite(candidate)) return candidate;
  }

  return fallback;
}
