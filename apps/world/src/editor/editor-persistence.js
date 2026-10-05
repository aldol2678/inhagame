import { WorldDocument } from "./world-document.js";
import { parseWorld, serializeWorld } from "./world-serialization.js";
import { validateWorld } from "./world-schema.js";

export function prepareWorldSave(document) {
  const snapshot = document.snapshot();
  const validation = validateWorld(snapshot);
  if (!validation.valid) {
    const first = validation.errors[0];
    throw new Error(`${first.code}:${first.path}`);
  }
  return { text: serializeWorld(snapshot), validation, revision: document.revision };
}

export async function saveWorldDocument(document, store) {
  const { text, validation, revision } = prepareWorldSave(document);
  await store.writeCanonicalVerified(document.worldId, text);
  const readback = await store.readCanonical(document.worldId);
  if (readback !== text || serializeWorld(parseWorld(readback)) !== text) {
    throw new Error("E_WORLD_SAVE_READBACK_MISMATCH");
  }
  const saved = document.revision === revision;
  if (saved) document.markSaved();
  return { saved, warnings: validation.warnings, text };
}

export function loadWorldDocument(text, { unsaved = false } = {}) {
  const document = new WorldDocument(parseWorld(text));
  if (unsaved) document.markUnsaved();
  return document;
}
