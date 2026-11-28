import { linearSwatch, matchesSwatch } from './annyongi-face-layout.mjs';

// Diagnostic copies only. The fixed pass renders the untouched game mesh.
// The reference pass recolors just the stroke to the head's authored color,
// keeping its shape, lighting, normals and contact shadows identical.
export function vertexLineControls(pc, instance, line, idColor, skinColor) {
  const source = instance.mesh;
  const positions = [], normals = [], colors = [], indices = [];
  source.getPositions(positions);
  source.getNormals(normals);
  source.getColors(colors);
  source.getIndices(indices);
  const count = positions.length / 3;
  if (colors.length !== count * 4 || !instance.material.diffuseVertexColor) {
    throw Error(`Missing vertex palette for ${line.name}`);
  }
  const swatch = linearSwatch(line.swatch);
  const selected = Array.from({length: count}, (_, i) => matchesSwatch(colors, i * 4, swatch));
  const stroke = [];
  for (let i = 0; i < indices.length; i += 3) {
    const face = indices.slice(i, i + 3);
    if (face.every(index => selected[index])) stroke.push(...face);
    else if (face.some(index => selected[index])) throw Error(`Mixed palette triangle in ${line.name}`);
  }
  if (!stroke.length) throw Error(`Empty authored line: ${line.name}`);
  const reference = colors.slice(), mask = [];
  for (let i = 0; i < count; i++) {
    if (selected[i]) for (let c = 0; c < 3; c++) reference[i * 4 + c] = skinColor[c];
    mask.push(...(selected[i] ? idColor : [0, 0, 0]), 1);
  }
  function copy(vertexColors, faces) {
    const mesh = new pc.Mesh(source.device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setColors(vertexColors);
    mesh.setIndices(faces);
    mesh.update();
    return mesh;
  }
  return { source, reference: copy(reference, indices), mask: copy(mask, indices), stroke: copy(colors, stroke) };
}
