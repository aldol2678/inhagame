const finite = value => typeof value === "number" && Number.isFinite(value);

export function createMapReference({ name, mimeType, width, height, rightsNote }) {
  if (!name?.trim() || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new Error("E_MAP_REFERENCE_IMAGE_INVALID");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 8192 || height > 8192) {
    throw new Error("E_MAP_REFERENCE_DIMENSIONS_INVALID");
  }
  if (!rightsNote?.trim()) throw new Error("E_MAP_REFERENCE_RIGHTS_NOTE_REQUIRED");
  const metersPerPixel = 40 / Math.max(width, height);
  return {
    version: 1,
    name: name.trim(),
    mimeType,
    width,
    height,
    rightsNote: rightsNote.trim(),
    opacity: 0.5,
    metersPerPixel,
    anchorX: -width * metersPerPixel / 2,
    anchorZ: height * metersPerPixel / 2,
    footprints: []
  };
}

export function validateMapReference(reference) {
  if (!reference || reference.version !== 1 || !Number.isInteger(reference.width) || !Number.isInteger(reference.height) ||
    reference.width < 2 || reference.height < 2 || reference.width > 8192 || reference.height > 8192 ||
    !finite(reference.metersPerPixel) || reference.metersPerPixel <= 0 ||
    !finite(reference.anchorX) || !finite(reference.anchorZ) ||
    !finite(reference.opacity) || reference.opacity < 0 || reference.opacity > 1 ||
    !Array.isArray(reference.footprints)) throw new Error("E_MAP_REFERENCE_INVALID");
  for (const footprint of reference.footprints) validateFootprint(footprint.points);
  return reference;
}

export function imagePixelToWorld(reference, pixel) {
  validateMapReference(reference);
  if (!Array.isArray(pixel) || pixel.length !== 2 || !pixel.every(finite)) throw new Error("E_MAP_PIXEL_INVALID");
  return [reference.anchorX + pixel[0] * reference.metersPerPixel, reference.anchorZ - pixel[1] * reference.metersPerPixel];
}

export function worldToImagePixel(reference, point) {
  validateMapReference(reference);
  if (!Array.isArray(point) || point.length !== 2 || !point.every(finite)) throw new Error("E_MAP_WORLD_POINT_INVALID");
  return [(point[0] - reference.anchorX) / reference.metersPerPixel, (reference.anchorZ - point[1]) / reference.metersPerPixel];
}

export function footprintWorldPoints(reference, footprint) {
  validateFootprint(footprint.points);
  return footprint.points.map(pixel => imagePixelToWorld(reference, pixel));
}

export function calibrateMapReference(reference, firstPixel, secondPixel, meters) {
  const firstWorld = imagePixelToWorld(reference, firstPixel);
  const distancePixels = Math.hypot(secondPixel[0] - firstPixel[0], secondPixel[1] - firstPixel[1]);
  if (!finite(meters) || meters <= 0 || !finite(distancePixels) || distancePixels < 2) throw new Error("E_MAP_CALIBRATION_INVALID");
  const metersPerPixel = meters / distancePixels;
  return validateMapReference({
    ...reference,
    metersPerPixel,
    anchorX: firstWorld[0] - firstPixel[0] * metersPerPixel,
    anchorZ: firstWorld[1] + firstPixel[1] * metersPerPixel
  });
}

export function validateFootprint(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 1000 ||
    !points.every(point => Array.isArray(point) && point.length === 2 && point.every(finite))) {
    throw new Error("E_MAP_FOOTPRINT_POINTS_INVALID");
  }
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x, z] = points[index];
    const [nextX, nextZ] = points[(index + 1) % points.length];
    twiceArea += x * nextZ - nextX * z;
  }
  if (Math.abs(twiceArea) < 0.01) throw new Error("E_MAP_FOOTPRINT_AREA_INVALID");
  return points;
}
