// Asset Factory P0 AF-07 R2 preview adapter.
//
// This is not the canonical World Asset Registry. R2 replaces the temporary synthesized
// Inkyung identity only on explicitly enabled preview hosts. The generated layers remain
// candidates until human listening/device QA and canonical Asset Registry handoff complete.
export const AF07_R2_PROFILE_ID = "af07-r2";

export const AF07_R2_ASSET_IDS = Object.freeze({
  WATER_SHORE: "asset.audio.inkyung.water-shore",
  AIR_LIFE: "asset.audio.inkyung.air-life",
  RAIN: "asset.audio.inkyung.rain"
});

const RIGHTS_EVIDENCE = "https://help.runwayml.com/hc/en-us/articles/18927776141715-Usage-rights";

export const ASSET_FACTORY_PREVIEW_ASSETS = Object.freeze({
  [AF07_R2_ASSET_IDS.WATER_SHORE]: Object.freeze({
    id: AF07_R2_ASSET_IDS.WATER_SHORE,
    type: "audio",
    subtype: "ambience",
    revision: "r002",
    uri: "https://cdn.creativeclaw.co/u/c3f5adde/audio/2a32a575-d700-4d82-9157-fc439f122062.mp3",
    provenance: Object.freeze({
      originType: "ai-generated",
      provider: "Runway",
      sourceRef: "runway:dd1b2051-1cd7-4daf-b61d-86ce673c87a1",
      storageRef: "creative-claw:d535e011-38ae-43ba-b8c0-8a762f08b9d1",
      createdAt: "2026-10-04"
    }),
    rights: Object.freeze({
      status: "verified",
      scope: "project-game-commercial-use",
      commercialUse: true,
      attributionRequired: false,
      derivativesAllowed: null,
      redistributionAllowed: null,
      evidenceRef: RIGHTS_EVIDENCE
    }),
    qa: Object.freeze({
      status: "candidate-r2",
      evidenceRef: "https://docs.google.com/document/d/1XrsU1doujQqZrxraHWk0f8-xQcstgicOGE0PgqlXUoI/edit"
    }),
    runtime: Object.freeze({ previewOnly: true, gain: 0.18, offsetSeconds: 0 })
  }),
  [AF07_R2_ASSET_IDS.AIR_LIFE]: Object.freeze({
    id: AF07_R2_ASSET_IDS.AIR_LIFE,
    type: "audio",
    subtype: "ambience",
    revision: "r003",
    uri: "https://cdn.creativeclaw.co/u/c3f5adde/audio/79e8ca6e-efe8-4ac7-bd4f-fa2c12971d8b.mp3",
    provenance: Object.freeze({
      originType: "ai-generated",
      provider: "Runway",
      sourceRef: "runway:d3410db1-7269-4c23-b5e5-f0e873927b52",
      storageRef: "creative-claw:3f70e4e9-e6a8-40b7-8c4a-2d8f65773345",
      createdAt: "2026-10-04"
    }),
    rights: Object.freeze({
      status: "verified",
      scope: "project-game-commercial-use",
      commercialUse: true,
      attributionRequired: false,
      derivativesAllowed: null,
      redistributionAllowed: null,
      evidenceRef: RIGHTS_EVIDENCE
    }),
    qa: Object.freeze({
      status: "candidate-r2",
      evidenceRef: "https://docs.google.com/document/d/1XrsU1doujQqZrxraHWk0f8-xQcstgicOGE0PgqlXUoI/edit"
    }),
    runtime: Object.freeze({ previewOnly: true, gain: 0.10, offsetSeconds: 7.5 })
  }),
  [AF07_R2_ASSET_IDS.RAIN]: Object.freeze({
    id: AF07_R2_ASSET_IDS.RAIN,
    type: "audio",
    subtype: "ambience",
    revision: "r002",
    uri: "https://cdn.creativeclaw.co/u/c3f5adde/audio/70e7d50a-50f3-441d-ab43-5662c1c4ca4a.mp3",
    provenance: Object.freeze({
      originType: "ai-generated",
      provider: "Runway",
      sourceRef: "runway:7d844431-daf2-42a3-accd-db61cd10d729",
      storageRef: "creative-claw:86b382c7-89d0-4bc1-a4c3-c174fb8a9fe0",
      createdAt: "2026-10-04"
    }),
    rights: Object.freeze({
      status: "verified",
      scope: "project-game-commercial-use",
      commercialUse: true,
      attributionRequired: false,
      derivativesAllowed: null,
      redistributionAllowed: null,
      evidenceRef: RIGHTS_EVIDENCE
    }),
    qa: Object.freeze({
      status: "candidate-r2",
      evidenceRef: "https://docs.google.com/document/d/1XrsU1doujQqZrxraHWk0f8-xQcstgicOGE0PgqlXUoI/edit"
    }),
    runtime: Object.freeze({ previewOnly: true, gain: 0.14, offsetSeconds: 13 })
  })
});

export function resolveAssetFactoryPreviewAmbience({ profileId = null, zone = null, weather = null } = {}) {
  if (profileId !== AF07_R2_PROFILE_ID || zone !== "INKYUNG") return null;
  const rain = String(weather ?? "").toUpperCase() === "RAIN";
  const ids = [
    AF07_R2_ASSET_IDS.WATER_SHORE,
    AF07_R2_ASSET_IDS.AIR_LIFE,
    ...(rain ? [AF07_R2_ASSET_IDS.RAIN] : [])
  ];
  const assets = ids.map(id => ASSET_FACTORY_PREVIEW_ASSETS[id]).filter(Boolean);
  if (assets.length !== ids.length || assets.some(asset => !asset.runtime.previewOnly)) return null;
  return Object.freeze({
    id: `${AF07_R2_PROFILE_ID}:INKYUNG:${rain ? "RAIN" : "BASE"}`,
    replaceSynthetic: true,
    assets: Object.freeze(assets)
  });
}
