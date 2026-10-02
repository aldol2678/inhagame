import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const friend = readFileSync(new URL("../src/social/friend-panel.js", import.meta.url), "utf8");
const nearby = readFileSync(new URL("../src/social/nearby-panel.js", import.meta.url), "utf8");
const card = readFileSync(new URL("../src/social/player-card.js", import.meta.url), "utf8");
const guestbook = readFileSync(new URL("../src/guestbook/guestbook-panel.js", import.meta.url), "utf8");

test("friend panel emits lifecycle only when open state changes", () => {
  assert.match(friend, /onOpenChange = \(\) => \{\}/);
  assert.match(friend, /const changed = open !== nextOpen;/);
  assert.match(friend, /if \(changed\) onOpenChange\(open\);/);
});

test("nearby panel exposes lifecycle and hands off to player card before release", () => {
  assert.match(nearby, /onOpenChange = \(\) => \{\}/);
  assert.match(nearby, /onOpenChange\(open\);/);
  const inspect = nearby.match(/button\.addEventListener\("click",[\s\S]*?void opening;\s*\}\);/)?.[0] ?? "";
  assert.ok(inspect.indexOf("onInspect(row.sessionId)") < inspect.indexOf("setOpen(false)"));
});

test("player card lifecycle is idempotent across target replacement", () => {
  assert.match(card, /onOpenChange = \(\) => \{\}/);
  assert.match(card, /if \(!current\) return false;/);
  assert.match(card, /onOpenChange\(false\);/);
  assert.match(card, /const wasOpen = current !== null;/);
  assert.match(card, /if \(!wasOpen\) onOpenChange\(true\);/);
});

test("guestbook emits lifecycle only on real open-state changes", () => {
  assert.match(guestbook, /onOpenChange = \(\) => \{\}/);
  assert.match(guestbook, /const changed = open !== nextOpen;/);
  assert.match(guestbook, /if \(changed\) onOpenChange\(open\);/);
});
