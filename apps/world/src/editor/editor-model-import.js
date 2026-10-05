export const EDITOR_ASSET_PREFIX = "editor-asset://local/";

export function editorAssetUri(assetId) {
  if (!/^[A-Za-z0-9._-]+$/u.test(assetId)) throw new Error("E_EDITOR_ASSET_ID_INVALID");
  return `${EDITOR_ASSET_PREFIX}${assetId}.glb`;
}

export function isEditorAssetUri(uri) {
  return typeof uri === "string" && uri.startsWith(EDITOR_ASSET_PREFIX) && /\.glb$/iu.test(uri);
}

async function glbBlob(blob, code = "E_MODEL_GLB_INVALID") {
  if (!(blob instanceof Blob) || blob.size < 20) throw new Error(code);
  const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (magic[0] !== 0x67 || magic[1] !== 0x6c || magic[2] !== 0x54 || magic[3] !== 0x46) throw new Error(code);
  return blob.type === "model/gltf-binary" ? blob : blob.slice(0, blob.size, "model/gltf-binary");
}

export async function importEditorModel({ file, worldId, assetId, store, fetcher = fetch }) {
  if (!(file instanceof Blob) || !file.name) throw new Error("E_MODEL_FILE_REQUIRED");
  if (!store || !worldId || !assetId) throw new Error("E_MODEL_IMPORT_CONTEXT_REQUIRED");
  if (file.size > 25 * 1024 * 1024) throw new Error("E_MODEL_FILE_TOO_LARGE");
  const lower = file.name.toLowerCase();
  let blob;
  let sourceFormat;
  if (lower.endsWith(".glb")) {
    blob = await glbBlob(file);
    sourceFormat = "glb";
  } else if (lower.endsWith(".fbx")) {
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
    blob = await glbBlob(await response.blob(), "E_MODEL_CONVERT_INVALID_GLB");
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
    uri: editorAssetUri(assetId),
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
