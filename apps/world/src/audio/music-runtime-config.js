import {
  normalizeMusicProject,
  validateMusicProject
} from "../music-editor/music-document.js";

const runtimeError = (code, detail = null) => {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  error.detail = detail;
  return error;
};

export function validateRuntimeMusicProject(project) {
  const normalized = normalizeMusicProject(project);
  const base = validateMusicProject(normalized);
  if (!base.valid) throw runtimeError(base.errors[0].code, base.errors[0].path);

  for (const asset of normalized.assets) {
    if (String(asset.uri || "").startsWith("project://")) {
      throw runtimeError("E_MUSIC_RUNTIME_PROJECT_URI", asset.id);
    }
    if (!asset.rights?.source || !asset.rights?.license || asset.rights?.approved !== true) {
      throw runtimeError("E_MUSIC_RUNTIME_RIGHTS_UNAPPROVED", asset.id);
    }
  }
  return normalized;
}

export async function loadRuntimeMusicProject({
  fetchFn = globalThis.fetch,
  url = "/data/music/music.json"
} = {}) {
  if (typeof fetchFn !== "function") throw runtimeError("E_MUSIC_RUNTIME_FETCH_UNAVAILABLE");
  let response;
  try {
    response = await fetchFn(url, { cache: "no-store" });
  } catch (error) {
    throw runtimeError("E_MUSIC_RUNTIME_CONFIG_FETCH", error?.message || String(error));
  }
  if (!response?.ok) throw runtimeError("E_MUSIC_RUNTIME_CONFIG_HTTP", String(response?.status ?? "unknown"));

  let raw;
  try { raw = await response.json(); }
  catch (error) { throw runtimeError("E_MUSIC_RUNTIME_CONFIG_JSON", error?.message || String(error)); }

  return validateRuntimeMusicProject(raw);
}
