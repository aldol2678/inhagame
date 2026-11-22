// Moa and Reality Base use the same WGS84 feature contract. A private port
// checkout can supply it at build time without shipping the handover bundle.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { geoToWorld } from '../../../apps/world/src/geo-coordinates.js';
import { projectPolygon } from '../../../apps/world/src/reality-adapter.js';
import { MAIN_ENTRANCE } from '../../../apps/world/src/basic-campus.js';
import { TOUR_STOPS } from '../../../apps/world/src/campus-layout.js';

export async function reality(name) {
  const path = new URL('../../../apps/world/data/reality/campus-' + name + '.json', import.meta.url);
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function spatialSource(portFile) {
  if (portFile) return import(pathToFileURL(resolve(portFile)));
  const [site, landmarks] = await Promise.all([reality('site'), reality('landmarks')]);
  return {
    geoToWorld,
    projectPolygon,
    MAIN_ENTRANCE,
    TOUR_STOPS,
    SITE_FEATURES: site.features,
    LANDMARKS: landmarks.landmarks,
  };
}
