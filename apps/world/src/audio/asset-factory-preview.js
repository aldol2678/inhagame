// Asset Factory P0 AF-07 preview adapter.
//
// This is not the canonical World Asset Registry. It is a bounded handoff shim for one
// generated audio candidate. Project/game usage rights have been verified against current
// CreativeClaw terms, but the entry remains preview-only until human listening QA,
// canonical Asset Registry support, and Runtime acceptance are complete.
export const AF07_INKYUNG_RAIN_ASSET_ID = "asset.campus.inkyung-rain-ambience";

export const ASSET_FACTORY_PREVIEW_ASSETS = Object.freeze({
  [AF07_INKYUNG_RAIN_ASSET_ID]: Object.freeze({
    id: AF07_INKYUNG_RAIN_ASSET_ID,
    type: "audio",
    subtype: "ambience",
    revision: "r001",
    uri: "https://cdn.creativeclaw.co/u/c3f5adde/audio/70039735-c45a-4cef-a3b7-c992849959b2.wav",
    provenance: Object.freeze({
      originType: "ai-generated",
      provider: "Creative Claw / ElevenLabs",
      sourceRef: "creative-claw:3294b58e-a857-4d68-921e-709be71b4feb",
      createdAt: "2026-10-04"
    }),
    rights: Object.freeze({
      status: "verified",
      scope: "project-game-commercial-use",
      commercialUse: true,
      attributionRequired: false,
      derivativesAllowed: null,
      redistributionAllowed: null,
      evidenceRef: "https://docs.google.com/document/d/1-nfS8M9daNjVB9uBvO9uUaEK9xOH_qNlZjzAF1Vp5cs/edit"
    }),
    qa: Object.freeze({
      status: "partial-pass",
      evidenceRef: "https://docs.google.com/document/d/1-nfS8M9daNjVB9uBvO9uUaEK9xOH_qNlZjzAF1Vp5cs/edit"
    }),
    runtime: Object.freeze({
      previewOnly: true,
      zone: "INKYUNG",
      weather: "RAIN",
      gain: 0.22
    })
  })
});

export function resolveAssetFactoryPreviewAmbience({ assetId = null, zone = null, weather = null } = {}) {
  if (!assetId) return null;
  const asset = ASSET_FACTORY_PREVIEW_ASSETS[assetId] ?? null;
  if (!asset?.runtime?.previewOnly) return null;
  if (asset.runtime.zone !== zone) return null;
  if (asset.runtime.weather !== String(weather ?? "").toUpperCase()) return null;
  return asset;
}
