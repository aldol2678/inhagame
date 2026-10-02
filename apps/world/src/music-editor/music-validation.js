import {
  normalizeMusicProject,
  parseMusicProject,
  serializeMusicProject,
  validateMusicProject
} from "./music-document.js";

const diagnostic = (severity, code, path, detail = null) =>
  Object.freeze({ severity, code, path, ...(detail ? { detail } : {}) });

const dedupe = items => {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.severity}|${item.code}|${item.path}|${item.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function diagnoseMusicProject(project, {
  placeZoneIds = null,
  placeIds = null,
  roomIds = null,
  shortLoopSeconds = 0.5,
  shortFadeSeconds = 0.1
} = {}) {
  const base = validateMusicProject(project, { placeZoneIds, placeIds, roomIds });
  const diagnostics = [...base.diagnostics];
  const assets = Array.isArray(project?.assets) ? project.assets : [];
  const cues = Array.isArray(project?.cues) ? project.cues : [];
  const bindings = Array.isArray(project?.bindings) ? project.bindings : [];

  const usedAssets = new Set(cues.map(cue => cue?.assetId).filter(Boolean));
  const usedCues = new Set(bindings.map(binding => binding?.cueId).filter(Boolean));

  assets.forEach((asset, index) => {
    const path = `assets[${index}]`;
    if (asset?.id && !usedAssets.has(asset.id)) {
      diagnostics.push(diagnostic("WARNING", "W_MUSIC_ASSET_UNUSED", path, asset.id));
    }
    if (asset?.rights?.approved !== true) {
      diagnostics.push(diagnostic("WARNING", "W_MUSIC_RIGHTS_UNAPPROVED", `${path}.rights.approved`, asset?.id ?? null));
    }
  });

  cues.forEach((cue, index) => {
    const path = `cues[${index}]`;
    if (cue?.id && !usedCues.has(cue.id)) {
      diagnostics.push(diagnostic("WARNING", "W_MUSIC_CUE_UNUSED", path, cue.id));
    }
    const loop = cue?.loop;
    if (loop?.enabled === true && Number.isFinite(Number(loop.startSeconds)) && Number.isFinite(Number(loop.endSeconds))) {
      const duration = Number(loop.endSeconds) - Number(loop.startSeconds);
      if (duration > 0 && duration < shortLoopSeconds) {
        diagnostics.push(diagnostic("WARNING", "W_MUSIC_LOOP_VERY_SHORT", `${path}.loop`, duration.toFixed(3)));
      }
    }
    for (const key of ["fadeInSeconds", "fadeOutSeconds"]) {
      const value = Number(cue?.transition?.[key]);
      if (Number.isFinite(value) && value > 0 && value < shortFadeSeconds) {
        diagnostics.push(diagnostic("WARNING", "W_MUSIC_FADE_VERY_SHORT", `${path}.transition.${key}`, String(value)));
      }
    }
  });

  const unique = dedupe(diagnostics);
  const errors = unique.filter(item => item.severity === "ERROR");
  const warnings = unique.filter(item => item.severity === "WARNING");
  return Object.freeze({
    valid: errors.length === 0,
    diagnostics: Object.freeze(unique),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    counts: Object.freeze({ errors: errors.length, warnings: warnings.length })
  });
}

export async function buildMusicExportCandidate(project, {
  placeZoneIds = null,
  placeIds = null,
  roomIds = null,
  hasAssetBlob = async () => true
} = {}) {
  const normalized = normalizeMusicProject(project);
  let report = diagnoseMusicProject(normalized, { placeZoneIds, placeIds, roomIds });
  const diagnostics = [...report.diagnostics];

  for (let index = 0; index < normalized.assets.length; index += 1) {
    const asset = normalized.assets[index];
    if (!String(asset.uri || "").startsWith("project://")) continue;
    let exists = false;
    try { exists = await hasAssetBlob(asset); }
    catch { exists = false; }
    if (!exists) {
      diagnostics.push(diagnostic("ERROR", "E_MUSIC_ASSET_BLOB_MISSING", `assets[${index}].uri`, asset.id));
    }
  }

  let errors = dedupe(diagnostics).filter(item => item.severity === "ERROR");
  let warnings = dedupe(diagnostics).filter(item => item.severity === "WARNING");
  if (errors.length) {
    return Object.freeze({
      ok: false, text: null, readback: null,
      diagnostics: Object.freeze(dedupe(diagnostics)),
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      counts: Object.freeze({ errors: errors.length, warnings: warnings.length }),
      semanticEqual: false
    });
  }

  let text;
  let readback;
  let semanticEqual = false;
  try {
    text = serializeMusicProject(normalized);
    readback = parseMusicProject(text);
    const readbackReport = diagnoseMusicProject(readback, { placeZoneIds, placeIds, roomIds });
    diagnostics.push(...readbackReport.diagnostics);
    semanticEqual = JSON.stringify(normalized) === JSON.stringify(readback);
    if (!semanticEqual) {
      diagnostics.push(diagnostic("ERROR", "E_MUSIC_EXPORT_READBACK_MISMATCH", "$"));
    }
  } catch (error) {
    diagnostics.push(diagnostic("ERROR", "E_MUSIC_EXPORT_READBACK_FAILED", "$", error?.message || "unknown"));
  }

  const unique = dedupe(diagnostics);
  errors = unique.filter(item => item.severity === "ERROR");
  warnings = unique.filter(item => item.severity === "WARNING");
  return Object.freeze({
    ok: errors.length === 0 && semanticEqual,
    text: errors.length === 0 && semanticEqual ? text : null,
    readback: errors.length === 0 && semanticEqual ? readback : null,
    diagnostics: Object.freeze(unique),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    counts: Object.freeze({ errors: errors.length, warnings: warnings.length }),
    semanticEqual
  });
}

const LABELS = Object.freeze({
  E_MUSIC_ASSET_BLOB_MISSING: "프로젝트 음원 원본이 브라우저 저장소에 없습니다.",
  E_MUSIC_EXPORT_READBACK_MISMATCH: "Export readback의 의미가 원본 프로젝트와 다릅니다.",
  E_MUSIC_EXPORT_READBACK_FAILED: "Export readback 검증에 실패했습니다.",
  W_MUSIC_ASSET_UNUSED: "어떤 Cue에서도 사용하지 않는 Asset입니다.",
  W_MUSIC_CUE_UNUSED: "어떤 Binding에서도 사용하지 않는 Cue입니다.",
  W_MUSIC_RIGHTS_UNAPPROVED: "권리 승인 상태가 아직 확인되지 않았습니다.",
  W_MUSIC_LOOP_VERY_SHORT: "Loop 구간이 매우 짧습니다. seam을 다시 확인하세요.",
  W_MUSIC_FADE_VERY_SHORT: "Fade 시간이 매우 짧습니다. 클릭/급전환을 확인하세요.",
  W_MUSIC_CUE_GAIN_ABOVE_UNITY: "Cue gain이 1.0을 초과합니다. clipping 가능성을 확인하세요.",
  W_MUSIC_BINDING_TARGET_UNKNOWN: "현재 World 레지스트리에 없는 Target입니다.",
  W_MUSIC_RIGHTS_SOURCE_MISSING: "음원 Source 정보가 없습니다.",
  W_MUSIC_LICENSE_MISSING: "음원 License 정보가 없습니다."
});

export function describeMusicDiagnostic(item) {
  return LABELS[item?.code] || item?.code || "Unknown diagnostic";
}
