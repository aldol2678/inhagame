// INHA WORLD Progression P1a · Reward EXP detail line (read-only presentation).
// The amount comes only from a server Reward result entry (`rewardResult.entries[]` with
// grantType "EXP"). Nothing is inferred from totalExp, Level, reward ids or constants.
// P0-F1 settles an EXP entry as GRANTED (granted = requested, confirmed by the EXP ledger) or
// FAILED (granted = 0); EXP is never SKIPPED. Only a GRANTED entry with a positive integer
// `granted` is shown as earned; anything else yields no line, and the server reason is never shown.

const formatCount = (value) => Number(value).toLocaleString("en-US");

/** "+N EXP" for a settled EXP grant entry, or null when the entry must not read as earned. */
export function rewardExpLine(entry) {
  if (!entry || entry.grantType !== "EXP" || entry.status !== "GRANTED") return null;
  const amount = entry.granted;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return `+${formatCount(amount)} EXP`;
}
