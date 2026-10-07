import assert from "node:assert/strict";
import { createWorldLoading, installWorldBootDiagnostics } from "../src/lobby/lobby-loading.js";

function element() {
  return { dataset: {}, hidden: false, textContent: "", style: {}, classList: { add() {} },
    setAttribute() {} };
}
function target() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch(type, event) { listeners.get(type)?.(event); }
  };
}
const root = element(), message = element(), detail = element();
const loading = createWorldLoading({
  root, messageElement: message, detailElement: detail, barElement: element(), percentElement: element(),
  timers: { setTimeout: () => 1, clearTimeout() {} }
});
const win = target();
const diagnostics = installWorldBootDiagnostics({ target: win, loading });
win.dispatch("error", { message: "SyntaxError: unexpected token" });
assert.equal(root.dataset.state, "ERROR");
assert.match(message.textContent, /초기 로딩/);
assert.match(detail.textContent, /BOOT_SCRIPT_ERROR/);
assert.match(detail.textContent, /SyntaxError/);

const root2 = element(), message2 = element(), detail2 = element();
const loading2 = createWorldLoading({
  root: root2, messageElement: message2, detailElement: detail2, barElement: element(), percentElement: element(),
  timers: { setTimeout: () => 1, clearTimeout() {} }
});
const win2 = target();
const diagnostics2 = installWorldBootDiagnostics({ target: win2, loading: loading2 });
diagnostics2.markBootEntered();
win2.dispatch("error", { message: "late error" });
assert.equal(root2.dataset.state, "LOADING", "post-boot errors remain owned by boot().catch/runtime handling");
diagnostics.destroy();
diagnostics2.destroy();
console.log("pre-boot diagnostics: PASS");
