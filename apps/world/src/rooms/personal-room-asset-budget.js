import { furnitureVisualForItem } from './furniture-visual-assets.js';

// Design hypotheses only. These are NOT measured GPU budgets or release gates,
// and MUST NOT change world quality, reject a model, or downscale official art.
export const PERSONAL_ROOM_ASSET_TARGETS = Object.freeze({
  low: Object.freeze({ frameDrawCalls: 400, frameTriangles: 160000, textureMiB: 64, incrementalHeapMiB: 64, transferMiB: 4 }),
  medium: Object.freeze({ frameDrawCalls: 650, frameTriangles: 300000, textureMiB: 128, incrementalHeapMiB: 96, transferMiB: 8 }),
  high: Object.freeze({ frameDrawCalls: 900, frameTriangles: 500000, textureMiB: 192, incrementalHeapMiB: 128, transferMiB: 12 })
});
export const PERSONAL_ROOM_MAX_OWNED_PLACEMENTS = 32;

export function personalRoomAssetDiagnostics(objects, { profile = 'low', fixedVisuals = [] } = {}) {
  if (!Object.hasOwn(PERSONAL_ROOM_ASSET_TARGETS, profile)) throw Error('UNKNOWN_ROOM_PROFILE');
  const known = objects.map(object => furnitureVisualForItem(object.itemId));
  const visuals = [...known.filter(Boolean), ...fixedVisuals];
  const unique = new Map(visuals.map(visual => [JSON.stringify([visual.url, visual.version]), visual]));
  return {
    scope: 'personal-room-only', status: 'diagnostic-unvalidated-design-targets',
    physicalGpuValidated: false, maxOwnedPlacements: PERSONAL_ROOM_MAX_OWNED_PLACEMENTS,
    ownedPlacements: objects.length, placementLimitExceeded: objects.length > PERSONAL_ROOM_MAX_OWNED_PLACEMENTS,
    knownVisualPlacements: visuals.length, unaccountedOwnedPlacements: known.filter(value => !value).length,
    uniqueVisualSources: unique.size,
    // Static, single-pass, unculled estimates for registered GLBs only. Room shell,
    // procedural fallbacks, avatars, effects, shadows and UI remain unmeasured.
    registeredGlbEstimates: {
      trianglesSinglePass: visuals.reduce((sum, visual) => sum + visual.triangles, 0),
      primitiveSubmissionsSinglePass: visuals.reduce((sum, visual) => sum + visual.primitives, 0),
      uniqueTransferBytes: [...unique.values()].reduce((sum, visual) => sum + visual.byteLength, 0),
      uniqueTextureBytes: [...unique.values()].reduce((sum, visual) => sum + visual.textureBytesEstimate, 0)
    },
    runtimeMeasurements: { totalFrameDrawCalls: null, totalFrameTriangles: null, gpuFrameP95Ms: null, incrementalHeapBytes: null, transitionPeakBytes: null },
    provisionalTargets: PERSONAL_ROOM_ASSET_TARGETS[profile], releaseVerdict: 'not_measured'
  };
}
