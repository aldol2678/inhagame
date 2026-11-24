import { COOKING_AVAILABLE, createCookingClient } from "./cooking-client.js";
import { createCookingPanel } from "./cooking-panel.js";

// Shared B1 provider integration. This does not enable COMING_SOON by itself.
// AUTH (migrated 2026-11-13, Tier 4 guest-open — A-2): the feature takes getSessionId and passes
// it to the cooking client, which authenticates with the v0.1 guest session id in the
// `X-Session-Id` header only. Before: getClient for the signed-in permanent-account client.
export function createCookingFeature({ getSessionId, getUserId, getRoomState, inventory,
  isAvailable = () => COOKING_AVAILABLE, onOpenChange = () => {}, doc = document }) {
  let panel;
  const client = createCookingClient({ getSessionId, getUserId, getRoomState, isAvailable,
    onChange: () => panel?.update(),
    onReceipt: async receipt => {
      const actor = getUserId();
      if (!actor || receipt.userId !== actor || inventory.accountId !== actor) return false;
      // A failed Inventory read may be retried from UNAVAILABLE. Identity must match before
      // starting, then the same captured actor and a canonical READY read must match afterward.
      const refreshed = await inventory.refresh("cooking");
      return refreshed === true && getUserId() === actor && inventory.accountId === actor && inventory.state === "READY";
    }
  });
  panel = createCookingPanel({ client, onOpenChange, doc });
  return { client, panel,
    handler: () => panel.openPanel(),
    isAvailable: feature => feature.kind === "cook" && client.available(),
    update: () => panel.update(),
    reset() { panel.close({ restoreFocus: false }); client.reset(); }
  };
}
