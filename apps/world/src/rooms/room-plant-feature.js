import { ROOM_PLANT_AVAILABLE, createRoomPlantClient } from "./room-plant-client.js";
import { createRoomPlantPanel } from "./room-plant-panel.js";

export function createRoomPlantFeature({ getClient, getUserId, getRoomState, inventory, onVisuals = () => {},
  openEditor = () => false, onOpenChange = () => {}, isAvailable = () => ROOM_PLANT_AVAILABLE,
  now = () => performance.now(), doc = document, win = globalThis.window }) {
  let panel, lastAttempt = -Infinity, lastGeneration = -1;
  const freshInventory = async actor => {
    const before = client.state().generation;
    if (getUserId() !== actor || inventory.accountId !== actor) return false;
    const ok = await inventory.refresh("room-plant");
    return ok === true && before === client.state().generation && client.available() && getUserId() === actor
      && inventory.accountId === actor && inventory.state === "READY";
  };
  const client = createRoomPlantClient({ getClient, getUserId, getRoomState, isAvailable,
    refreshInventory: freshInventory, onChange: () => { onVisuals(client.visuals()); panel?.update(); } });
  panel = createRoomPlantPanel({ client, getRoomState, doc, win, onOpenChange,
    onPlace: async () => {
      const s = client.state(), gen = s.generation;
      if (s.role !== "owner" || !s.ready || !s.snapshot?.planterOwned || !await freshInventory(s.accountId)) return false;
      if (gen !== client.state().generation || !panel.open || !client.state().ready || getRoomState().role !== "owner") return false;
      panel.close({ restoreFocus: false }); return openEditor() === true;
    } });
  return { client, panel,
    handler: target => panel.openPanel(target),
    isAvailable: feature => feature.kind === "plant" && client.available(),
    update() {
      client.sync(); panel.update();
      if (lastGeneration !== client.state().generation) { lastGeneration = client.state().generation; lastAttempt = -Infinity; }
      const clock = now();
      if (client.available() && clock - lastAttempt >= 15000 && !client.state().pending && !client.state().reading) {
        lastAttempt = clock; void client.refresh();
      }
    },
    inventoryChanged() { client.inventoryChanged(inventory); },
    reset() { panel.close({ restoreFocus: false }); client.reset(); lastAttempt = -Infinity; },
    dispose() { panel.dispose(); client.reset(); }
  };
}
