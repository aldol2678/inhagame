// Display-referred sRGB luma, not physical luminance. ROIs are authored for the
// 1280x720 Biryong station-entry camera fixture; no HUD/nameplate pixels included.
export const BIRYONG_NIGHT_PIXEL_GATE = Object.freeze({
  width: 1280, height: 720,
  minimumMedian: .03, // ~8/255: prevent surface/character channels collapsing to near black.
  nearBlackBelow: .02,
  maximumNearBlackFraction: .25,
  minimumCharacterContrast: .02, // At least ~5/255 against the adjacent approach surface.
  regions: Object.freeze({
    road: Object.freeze({ rect: [320,270,500,440], meaning: 'walkable station approach surface' }),
    station: Object.freeze({ rect: [400,80,500,125], meaning: 'station facade, excluding signage and nameplates' }),
    character: Object.freeze({ rect: [620,400,660,480], meaning: 'player torso, excluding overhead nameplate' }),
    characterBackground: Object.freeze({ rect: [680,400,720,480], meaning: 'approach surface immediately beside player torso' })
  })
});
export function analyzeBiryongNightPixels({ width, height, data }) {
  const gate = BIRYONG_NIGHT_PIXEL_GATE, errors = [], regions = {};
  if (width !== gate.width || height !== gate.height || data?.length !== width * height * 4)
    return { passed: false, errors: ['Expected opaque 1280x720 RGBA station-entry screenshot'], regions, gate };
  for (const [name, region] of Object.entries(gate.regions)) {
    const [x0,y0,x1,y1] = region.rect, values = [];
    let nearBlack = 0, transparent = 0;
    for (let y=y0; y<y1; y++) for (let x=x0; x<x1; x++) {
      const i=(y*width+x)*4;
      const luma=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;
      values.push(luma); if (luma < gate.nearBlackBelow) nearBlack++;
      if (data[i+3] !== 255) transparent++;
    }
    values.sort((a,b)=>a-b);
    const median=values[Math.floor(values.length/2)], nearBlackFraction=nearBlack/values.length;
    regions[name]={ ...region, pixels: values.length, median, nearBlackFraction };
    if (transparent) errors.push(`${name}: transparent screenshot pixels`);
    if (median < gate.minimumMedian) errors.push(`${name}: median ${median} < ${gate.minimumMedian}`);
    if (nearBlackFraction > gate.maximumNearBlackFraction) errors.push(`${name}: near-black fraction ${nearBlackFraction} > ${gate.maximumNearBlackFraction}`);
  }
  const characterContrast=Math.abs(regions.character.median-regions.characterBackground.median);
  if (characterContrast < gate.minimumCharacterContrast) errors.push(`character contrast ${characterContrast} < ${gate.minimumCharacterContrast}`);
  return { passed: errors.length === 0, errors, regions, characterContrast, gate };
}
