// Accept stored numbers and nonblank legacy numeric strings, never coercible objects or booleans.
export function normalizeNumericSetting(value, fallback, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}
