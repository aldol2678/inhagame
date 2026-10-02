const DB_NAME = "inha-world-editor-v1";
const DB_VERSION = 3;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("E_EDITOR_STORE_REQUEST"));
  });
}

function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("E_EDITOR_STORE_ABORT"));
    transaction.onerror = () => reject(transaction.error || new Error("E_EDITOR_STORE_TRANSACTION"));
  });
}

export class EditorBrowserStore {
  constructor(database) { this.database = database; }

  static async open() {
    if (!globalThis.indexedDB) throw new Error("E_EDITOR_STORE_UNAVAILABLE");
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("canonical")) database.createObjectStore("canonical");
      if (!database.objectStoreNames.contains("recovery")) database.createObjectStore("recovery");
      if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings");
      if (!database.objectStoreNames.contains("references")) database.createObjectStore("references");
      if (!database.objectStoreNames.contains("assets")) database.createObjectStore("assets");
    };
    return new EditorBrowserStore(await requestResult(request));
  }

  async writeCanonicalVerified(worldId, text) {
    const transaction = this.database.transaction(["canonical", "settings"], "readwrite");
    const done = completed(transaction);
    const canonical = transaction.objectStore("canonical");
    canonical.put(text, worldId);
    const readback = await requestResult(canonical.get(worldId));
    if (readback !== text) {
      transaction.abort();
      await done.catch(() => {});
      throw new Error("E_WORLD_SAVE_READBACK_MISMATCH");
    }
    transaction.objectStore("settings").put(worldId, "lastWorldId");
    await done;
  }

  async readCanonical(worldId) {
    const transaction = this.database.transaction("canonical", "readonly");
    return (await requestResult(transaction.objectStore("canonical").get(worldId))) ?? null;
  }

  async readLatestCanonical() {
    const transaction = this.database.transaction("settings", "readonly");
    const worldId = await requestResult(transaction.objectStore("settings").get("lastWorldId"));
    return worldId ? this.readCanonical(worldId) : null;
  }

  async listProjects() {
    const transaction = this.database.transaction("canonical", "readonly");
    const canonical = transaction.objectStore("canonical");
    const [ids, texts] = await Promise.all([
      requestResult(canonical.getAllKeys()),
      requestResult(canonical.getAll())
    ]);
    return ids.map((worldId, index) => ({ worldId, text: texts[index] }));
  }

  async selectProject(worldId) {
    const transaction = this.database.transaction("settings", "readwrite");
    const done = completed(transaction);
    transaction.objectStore("settings").put(worldId, "lastWorldId");
    await done;
  }

  async writeRecovery(worldId, text) {
    const transaction = this.database.transaction("recovery", "readwrite");
    const done = completed(transaction);
    transaction.objectStore("recovery").put({ worldId, text, updatedAt: Date.now() }, "latest");
    await done;
  }

  async readRecovery() {
    const transaction = this.database.transaction("recovery", "readonly");
    return (await requestResult(transaction.objectStore("recovery").get("latest"))) ?? null;
  }

  async clearRecovery(worldId = null) {
    const transaction = this.database.transaction("recovery", "readwrite");
    const done = completed(transaction);
    const recovery = transaction.objectStore("recovery");
    const current = await requestResult(recovery.get("latest"));
    if (current && (worldId === null || current.worldId === worldId)) recovery.delete("latest");
    await done;
  }

  async writeReference(worldId, record) {
    const transaction = this.database.transaction("references", "readwrite");
    const done = completed(transaction);
    transaction.objectStore("references").put(record, worldId);
    await done;
  }

  async readReference(worldId) {
    const transaction = this.database.transaction("references", "readonly");
    return (await requestResult(transaction.objectStore("references").get(worldId))) ?? null;
  }

  async writeAsset(worldId, assetId, record) {
    const transaction = this.database.transaction("assets", "readwrite");
    const done = completed(transaction);
    transaction.objectStore("assets").put(record, `${worldId}::${assetId}`);
    await done;
  }

  async readAsset(worldId, assetId) {
    const transaction = this.database.transaction("assets", "readonly");
    return (await requestResult(transaction.objectStore("assets").get(`${worldId}::${assetId}`))) ?? null;
  }

  async deleteAsset(worldId, assetId) {
    const transaction = this.database.transaction("assets", "readwrite");
    const done = completed(transaction);
    transaction.objectStore("assets").delete(`${worldId}::${assetId}`);
    await done;
  }

  async clearReference(worldId) {
    const transaction = this.database.transaction("references", "readwrite");
    const done = completed(transaction);
    transaction.objectStore("references").delete(worldId);
    await done;
  }
}
