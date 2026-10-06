// Small player-facing Korean particle helper used by NPC dialogue labels.
// Hangul syllables with a jongseong take "과"; everything else takes "와".
export function withAnd(value) {
  const name = String(value ?? '').trim();
  if (!name) return '';
  const code = name.charCodeAt(name.length - 1);
  const hasJongseong = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${name}${hasJongseong ? '과' : '와'}`;
}
