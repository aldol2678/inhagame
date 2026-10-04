// Central INHA WORLD Asset Registry, AF-09 first implementation.
//
// Records intentionally use the existing World Schema asset shape:
// { id, type, uri, metadata }. Provenance, rights, QA and revision live in metadata,
// so Editor/WorldDocument assets[] can consume the same records without inventing
// a second incompatible asset schema.

export const WORLD_ASSET_IDS = Object.freeze({
  INKYUNG_WATER_SHORE: "asset.audio.inkyung.water-shore",
  INKYUNG_AIR_LIFE: "asset.audio.inkyung.air-life",
  INKYUNG_RAIN: "asset.audio.inkyung.rain"
});

const R2_RECEIPT = "https://docs.google.com/document/d/1XrsU1doujQqZrxraHWk0f8-xQcstgicOGE0PgqlXUoI/edit";
const RUNWAY_RIGHTS = "https://help.runwayml.com/hc/en-us/articles/18927776141715-Usage-rights";

function freezeRecord(record) {
  const metadata = Object.freeze({
    ...record.metadata,
    provenance: Object.freeze({ ...record.metadata.provenance }),
    rights: Object.freeze({ ...record.metadata.rights }),
    qa: Object.freeze({ ...record.metadata.qa }),
    technical: Object.freeze({ ...record.metadata.technical })
  });
  return Object.freeze({ ...record, metadata });
}

export const WORLD_ASSET_REGISTRY = Object.freeze([
  freezeRecord({
    id: WORLD_ASSET_IDS.INKYUNG_WATER_SHORE,
    type: "audio",
    uri: "https://cdn.creativeclaw.co/u/c3f5adde/audio/2a32a575-d700-4d82-9157-fc439f122062.mp3",
    metadata: {
      subtype: "ambience",
      revision: "r002",
      provenance: {
        originType: "ai-generated",
        provider: "Runway",
        sourceRef: "runway:dd1b2051-1cd7-4daf-b61d-86ce673c87a1",
        storageRef: "creative-claw:d535e011-38ae-43ba-b8c0-8a762f08b9d1",
        createdAt: "2026-10-04"
      },
      rights: {
        status: "verified",
        scope: "project-game-commercial-use",
        commercialUse: true,
        attributionRequired: false,
        derivativesAllowed: null,
        redistributionAllowed: null,
        evidenceRef: RUNWAY_RIGHTS
      },
      qa: {
        status: "owner-accepted",
        semanticEvent: "water sloshing",
        intelligibleSpeechObserved: false,
        humanListening: "owner-accepted",
        evidenceRef: R2_RECEIPT
      },
      technical: { durationSeconds: 30, loop: true, container: "mp3" }
    }
  }),
  freezeRecord({
    id: WORLD_ASSET_IDS.INKYUNG_AIR_LIFE,
    type: "audio",
    uri: "https://cdn.creativeclaw.co/u/c3f5adde/audio/79e8ca6e-efe8-4ac7-bd4f-fa2c12971d8b.mp3",
    metadata: {
      subtype: "ambience",
      revision: "r003",
      provenance: {
        originType: "ai-generated",
        provider: "Runway",
        sourceRef: "runway:d3410db1-7269-4c23-b5e5-f0e873927b52",
        storageRef: "creative-claw:3f70e4e9-e6a8-40b7-8c4a-2d8f65773345",
        createdAt: "2026-10-04"
      },
      rights: {
        status: "verified",
        scope: "project-game-commercial-use",
        commercialUse: true,
        attributionRequired: false,
        derivativesAllowed: null,
        redistributionAllowed: null,
        evidenceRef: RUNWAY_RIGHTS
      },
      qa: {
        status: "owner-accepted",
        semanticEvent: "rustling",
        intelligibleSpeechObserved: false,
        humanListening: "owner-accepted",
        evidenceRef: R2_RECEIPT
      },
      technical: { durationSeconds: 30, loop: true, container: "mp3" }
    }
  }),
  freezeRecord({
    id: WORLD_ASSET_IDS.INKYUNG_RAIN,
    type: "audio",
    uri: "https://cdn.creativeclaw.co/u/c3f5adde/audio/70e7d50a-50f3-441d-ab43-5662c1c4ca4a.mp3",
    metadata: {
      subtype: "ambience",
      revision: "r002",
      provenance: {
        originType: "ai-generated",
        provider: "Runway",
        sourceRef: "runway:7d844431-daf2-42a3-accd-db61cd10d729",
        storageRef: "creative-claw:86b382c7-89d0-4bc1-a4c3-c174fb8a9fe0",
        createdAt: "2026-10-04"
      },
      rights: {
        status: "verified",
        scope: "project-game-commercial-use",
        commercialUse: true,
        attributionRequired: false,
        derivativesAllowed: null,
        redistributionAllowed: null,
        evidenceRef: RUNWAY_RIGHTS
      },
      qa: {
        status: "owner-accepted",
        semanticEvent: "sound of rain",
        intelligibleSpeechObserved: false,
        humanListening: "owner-accepted",
        evidenceRef: R2_RECEIPT
      },
      technical: { durationSeconds: 30, loop: true, container: "mp3" }
    }
  })
]);

const BY_ID = new Map(WORLD_ASSET_REGISTRY.map(asset => [asset.id, asset]));

export function getWorldAssetRecord(id) {
  return typeof id === "string" ? BY_ID.get(id) ?? null : null;
}

export function resolveWorldAssetRecord(id, {
  type = null,
  requireVerifiedRights = false,
  requireOwnerAcceptedQa = false
} = {}) {
  const asset = getWorldAssetRecord(id);
  if (!asset) return null;
  if (type && asset.type !== type) return null;
  if (requireVerifiedRights && asset.metadata?.rights?.status !== "verified") return null;
  if (requireOwnerAcceptedQa && asset.metadata?.qa?.status !== "owner-accepted") return null;
  return asset;
}

export function worldAssetRegistrySnapshot() {
  return WORLD_ASSET_REGISTRY.map(asset => ({
    id: asset.id,
    type: asset.type,
    uri: asset.uri,
    metadata: {
      ...asset.metadata,
      provenance: { ...asset.metadata.provenance },
      rights: { ...asset.metadata.rights },
      qa: { ...asset.metadata.qa },
      technical: { ...asset.metadata.technical }
    }
  }));
}
