const MAX_MODEL_BYTES = 25 * 1024 * 1024;

export const EDITOR_ASSET_PREFIX = "editor-asset://local/";

export function editorAssetUri(assetId) {
  if (typeof assetId !== "string" || !/^[A-Za-z0-9._-]+$/u.test(assetId)) throw new Error("E_EDITOR_ASSET_ID_INVALID");
  return `${EDITOR_ASSET_PREFIX}${assetId}.glb`;
}

export function isEditorAssetUri(uri) {
  return typeof uri === "string" && uri.startsWith(EDITOR_ASSET_PREFIX) && /\.glb$/iu.test(uri);
}

async function glbBlob(blob, code = "E_MODEL_GLB_INVALID") {
  if (!(blob instanceof Blob) || blob.size < 20) throw new Error(code);
  const header = new DataView(await blob.slice(0, 12).arrayBuffer());
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== blob.size) {
    throw new Error(code);
  }
  // Validate the GLB container, not the full glTF schema. Unknown extension chunks
  // are allowed after JSON / BIN (Khronos glTF 2.0, section 4.4.3).
  let offset = 12;
  let chunkIndex = 0;
  while (offset < blob.size) {
    if (blob.size - offset < 8) throw new Error(code);
    const chunk = new DataView(await blob.slice(offset, offset + 8).arrayBuffer());
    const length = chunk.getUint32(0, true);
    const type = chunk.getUint32(4, true);
    const end = offset + 8 + length;
    if (length % 4 !== 0 || end > blob.size) throw new Error(code);
    if (chunkIndex === 0 && type !== 0x4e4f534a) throw new Error(code);
    if (type === 0x4e4f534a) {
      if (chunkIndex !== 0) throw new Error(code);
      try {
        const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await blob.slice(offset + 8, end).arrayBuffer()));
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(code);
      } catch {
        throw new Error(code);
      }
    } else if (type === 0x004e4942 && chunkIndex !== 1) {
      throw new Error(code);
    }
    offset = end;
    chunkIndex++;
  }
  return blob.type === "model/gltf-binary" ? blob : blob.slice(0, blob.size, "model/gltf-binary");
}

export async function importEditorModel({ file, worldId, assetId, store, fetcher = fetch }) {
  if (!(file instanceof Blob) || typeof file.name !== "string" || !file.name.trim()) throw new Error("E_MODEL_FILE_REQUIRED");
  if (typeof store?.writeAsset !== "function" || typeof worldId !== "string" || !worldId.trim() || !assetId) {
    throw new Error("E_MODEL_IMPORT_CONTEXT_REQUIRED");
  }
  const uri = editorAssetUri(assetId);
  if (file.size > MAX_MODEL_BYTES) throw new Error("E_MODEL_FILE_TOO_LARGE");
  const lower = file.name.toLowerCase();
  let blob;
  let sourceFormat;
  if (lower.endsWith(".glb")) {
    blob = await glbBlob(file);
    sourceFormat = "glb";
  } else if (lower.endsWith(".fbx")) {
    if (typeof fetcher !== "function") throw new Error("E_MODEL_IMPORT_CONTEXT_REQUIRED");
    const response = await fetcher(`/api/model-convert?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Model-Filename": file.name },
      body: file
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json())?.error ?? ""; } catch {}
      throw new Error(detail || `E_MODEL_CONVERT_FAILED:${response.status}`);
    }
    const converted = await response.blob();
    if (converted.size > MAX_MODEL_BYTES) throw new Error("E_MODEL_CONVERT_TOO_LARGE");
    blob = await glbBlob(converted, "E_MODEL_CONVERT_INVALID_GLB");
    sourceFormat = "fbx";
  } else {
    throw new Error("E_MODEL_FILE_TYPE_UNSUPPORTED");
  }
  await store.writeAsset(worldId, assetId, {
    version: 1,
    fileName: file.name,
    sourceFormat,
    mimeType: "model/gltf-binary",
    size: blob.size,
    blob,
    updatedAt: Date.now()
  });
  return {
    uri,
    label: file.name.replace(/\.(?:fbx|glb)$/iu, "") + ".glb",
    sourceFormat,
    size: blob.size
  };
}

export function createEditorAssetResolver({ store, worldId, objectUrls = new Set() }) {
  const urlByAssetId = new Map();
  const pendingByAssetId = new Map();
  return async asset => {
    if (!isEditorAssetUri(asset?.uri)) return null;
    if (urlByAssetId.has(asset.id)) return urlByAssetId.get(asset.id);
    if (!pendingByAssetId.has(asset.id)) {
      const pending = Promise.resolve().then(async () => {
        const record = await store.readAsset(worldId, asset.id);
        if (!record?.blob) throw new Error(`R_EDITOR_ASSET_MISSING:${asset.id}`);
        const blob = await glbBlob(record.blob, `R_EDITOR_ASSET_INVALID:${asset.id}`);
        const url = URL.createObjectURL(blob);
        objectUrls.add(url);
        urlByAssetId.set(asset.id, url);
        return url;
      }).finally(() => pendingByAssetId.delete(asset.id));
      pendingByAssetId.set(asset.id, pending);
    }
    return pendingByAssetId.get(asset.id);
  };
}

export function revokeEditorAssetUrls(objectUrls) {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}
