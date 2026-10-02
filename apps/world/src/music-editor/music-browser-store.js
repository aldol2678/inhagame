const DB_NAME = "inha-world-music-editor-v1";
const DB_VERSION = 1;

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("E_MUSIC_STORE_REQUEST"));
  });
}

function complete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("E_MUSIC_STORE_ABORT"));
    transaction.onerror = () => reject(transaction.error || new Error("E_MUSIC_STORE_TRANSACTION"));
  });
}

const assetKey = (projectId, assetId) => `${projectId}::${assetId}`;

export class MusicBrowserStore {
  constructor(database) { this.database = database; }

  static async open() {
    if (!globalThis.indexedDB) throw new Error("E_MUSIC_STORE_UNAVAILABLE");
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["canonical", "recovery", "settings", "assets"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    return new MusicBrowserStore(await result(request));
  }

  async writeCanonicalVerified(projectId, text) {
    const transaction = this.database.transaction(["canonical", "settings"], "readwrite");
    const done = complete(transaction);
    const canonical = transaction.objectStore("canonical");
    canonical.put(text, projectId);
    const readback = await result(canonical.get(projectId));
    if (readback !== text) {
      transaction.abort();
      await done.catch(() => {});
      throw new Error("E_MUSIC_SAVE_READBACK_MISMATCH");
    }
    transaction.objectStore("settings").put(projectId, "lastProjectId");
    await done;
  }

  async readCanonical(projectId) {
    const transaction = this.database.transaction("canonical", "readonly");
    return (await result(transaction.objectStore("canonical").get(projectId))) ?? null;
  }

  async readLatestCanonical() {
    const transaction = this.database.transaction("settings", "readonly");
    const projectId = await result(transaction.objectStore("settings").get("lastProjectId"));
    return projectId ? this.readCanonical(projectId) : null;
  }

  async listProjects() {
    const transaction = this.database.transaction("canonical", "readonly");
    const store = transaction.objectStore("canonical");
    const [ids, texts] = await Promise.all([result(store.getAllKeys()), result(store.getAll())]);
    return ids.map((projectId, index) => ({ projectId, text: texts[index] }));
  }

  async writeRecovery(projectId, text) {
    const transaction = this.database.transaction("recovery", "readwrite");
    const done = complete(transaction);
    transaction.objectStore("recovery").put({ projectId, text, updatedAt: Date.now() }, "latest");
    await done;
  }

  async readRecovery() {
    const transaction = this.database.transaction("recovery", "readonly");
    return (await result(transaction.objectStore("recovery").get("latest"))) ?? null;
  }

  async clearRecovery(projectId = null) {
    const transaction = this.database.transaction("recovery", "readwrite");
    const done = complete(transaction);
    const store = transaction.objectStore("recovery");
    const current = await result(store.get("latest"));
    if (current && (projectId === null || current.projectId === projectId)) store.delete("latest");
    await done;
  }

  async writeAssetBlob(projectId, assetId, blob) {
    const transaction = this.database.transaction("assets", "readwrite");
    const done = complete(transaction);
    transaction.objectStore("assets").put(blob, assetKey(projectId, assetId));
    await done;
  }

  async readAssetBlob(projectId, assetId) {
    const transaction = this.database.transaction("assets", "readonly");
    return (await result(transaction.objectStore("assets").get(assetKey(projectId, assetId)))) ?? null;
  }

  async deleteAssetBlob(projectId, assetId) {
    const transaction = this.database.transaction("assets", "readwrite");
    const done = complete(transaction);
    transaction.objectStore("assets").delete(assetKey(projectId, assetId));
    await done;
  }
}
