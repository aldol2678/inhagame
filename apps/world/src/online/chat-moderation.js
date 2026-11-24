// INHA WORLD — campus local-chat profanity filter.
// Plugs into the moderation hook local-chat.js already defines:
// ChatComposer.check() gates sending, ChatFeed.receive() gates display.
// The word list is verbatim private.world_profile_banned_words (itself
// verbatim word-alchemy patch35 BATTLE_NICK_BANNED, 47 words: 37 Korean +
// 10 English). The same list gates profile nicknames server-side (SQL) and
// chat text client-side (JS). Adding a word is a list edit here + an INSERT
// there; keep the two lists in sync.
//
// Limits (be honest): client-side only. The chat transport is a place-zone
// Realtime broadcast that never passes through the Worker, so a modified
// client can still send a banned word. What the filter guarantees: a stock
// client never sends one, and a stock client never displays one (the
// receive-side check drops it before the feed). Same limit as the
// word-alchemy nickname filter (patch35), which is also client-side only.

export const CHAT_BANNED_WORDS = Object.freeze([
  "씨발", "시발", "시바", "씨바", "썅", "병신", "지랄", "개새끼", "개새", "개년",
  "새끼", "좆", "좃", "씹", "자지", "보지", "엿", "닥쳐", "꺼져", "죽어", "뒤져",
  "미친년", "미친놈", "ㅅㅂ", "ㅆㅂ", "ㅂㅅ", "ㅈㄹ",
  "섹스", "야동", "포르노", "자위", "음란",
  "쪽바리", "짱깨", "김치녀", "된장녀", "한남충",
  "fuck", "shit", "bitch", "cunt", "dick", "pussy", "whore", "slut", "bastard", "asshole",
]);

// Port of word-alchemy btNormalizeNickForFilter: NFKC, lowercase, leet
// 1->i / 0->o / @->a / $->s, strip separators, collapse runs.
export function normalizeChatFilterText(s) {
  let v = String(s ?? "").normalize("NFKC").toLowerCase();
  v = v.replace(/1/g, "i").replace(/0/g, "o").replace(/@/g, "a").replace(/\$/g, "s");
  v = v.replace(/[\s\-_.,~^*!?·•…]+/g, "");
  v = v.replace(/(.)\1+/g, "$1");
  return v;
}

// Both sides go through the same normalize: NFKC turns standalone
// compatibility jamo (ㅅㅂ U+3145 U+3142) into conjoining jamo
// (U+1109 U+1107), so a raw-list check would miss exactly the jamo words.
// (word-alchemy patch35's JS has this latent gap — its raw list never
// matches NFKC-normalized jamo input. Syllables round-trip under NFKC.)
const CHAT_BANNED_WORDS_NORMALIZED = CHAT_BANNED_WORDS.map(normalizeChatFilterText);

export function chatHasBannedWord(text) {
  const v = normalizeChatFilterText(text);
  if (!v) return false;
  return CHAT_BANNED_WORDS_NORMALIZED.some((w) => v.includes(w));
}

// local-chat.js moderation interface: check(text) -> { ok } and
// isBlocked(userId) -> boolean. Per-user blocking stays with the social
// block list (main.js wires isBlocked from social.isBlocked); this module
// only judges text.
export const chatModeration = Object.freeze({
  check: (text) => (chatHasBannedWord(text) ? { ok: false, reason: "banned_word" } : { ok: true }),
  isBlocked: () => false,
});
