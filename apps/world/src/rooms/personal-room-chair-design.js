// Self-authored fixed-chair source of truth. Metres, floor pivot, back at +Z.
// Shared by the runtime fallback and deterministic GLB generator, never RPC data.
// Fixed fixture turns toward its desk; owned furniture keeps its own yaw.
export const PERSONAL_ROOM_FIXED_CHAIR_YAW = 180;
const part = (name, material, shape, at, size) => Object.freeze({ name, material, shape,
  at: Object.freeze(at), size: Object.freeze(size) });
export const PERSONAL_ROOM_CHAIR_PARTS = Object.freeze([
  part('seat_frame', 'woodOak', 'timber', [0, .211, -.006], [.50, .035, .485]),
  part('seat_piping', 'fabricLinenSeam', 'cushion', [0, .236, -.014], [.478, .014, .464]),
  // Exact central support top is .27, unchanged from the fixed-seat contract.
  part('seat', 'fabricLinen', 'cushion', [0, .244, -.018], [.47, .052, .452]),
  ...[-1, 1].flatMap((x, ix) => [-1, 1].map((z, iz) =>
    part(`leg_${ix}_${iz}`, 'woodOak', 'leg', [x * .185, .102, z * .17], [.046, .204, .046]))),
  ...[-1, 1].map((x, i) => part(`back_post_${i}`, 'woodOak', 'timber', [x * .196, .392, .217], [.042, .394, .042])),
  part('back_oak_shell', 'woodOak', 'cushion', [0, .495, .224], [.448, .205, .048]),
  part('back_piping', 'fabricLinenSeam', 'cushion', [0, .495, .196], [.397, .165, .036]),
  part('back', 'fabricLinen', 'cushion', [0, .495, .184], [.386, .154, .046]),
  part('front_apron', 'woodOakDark', 'timber', [0, .193, -.211], [.40, .038, .024]),
  ...[-1, 1].map((x, i) => part(`side_apron_${i}`, 'woodOak', 'timber', [x * .216, .193, -.003], [.025, .04, .397])),
  ...[-1, 1].map((x, i) => part(`side_stretcher_${i}`, 'woodOak', 'timber', [x * .185, .086, 0], [.022, .024, .335]))
]);

const signedPower = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
// Small closed, rounded forms. The leg tapers towards the floor without moving
// its pivot or extending the footprint. UVs allow the shared wood/linen patterns.
export function buildPersonalRoomChairGeometry(shape = 'timber') {
  const [vertical, horizontal] = shape === 'cushion' ? [.38, .25] : [.17, .16];
  const segments = 16, rings = 8, positions = [0, -.5, 0], uvs = [.5, 0], indices = [];
  for (let r = 1; r < rings; r++) {
    const latitude = -Math.PI / 2 + r * Math.PI / rings;
    const y = .5 * signedPower(Math.sin(latitude), vertical);
    const radius = signedPower(Math.cos(latitude), vertical) * (shape === 'leg' ? .72 + (y + .5) * .28 : 1);
    for (let s = 0; s < segments; s++) {
      const longitude = s * Math.PI * 2 / segments;
      positions.push(.5 * radius * signedPower(Math.cos(longitude), horizontal), y,
        .5 * radius * signedPower(Math.sin(longitude), horizontal));
      uvs.push(s / segments, r / rings);
    }
  }
  const top = positions.length / 3;
  positions.push(0, .5, 0); uvs.push(.5, 1);
  for (let s = 0; s < segments; s++) {
    const next = (s + 1) % segments;
    indices.push(0, 1 + s, 1 + next);
    for (let r = 0; r < rings - 2; r++) {
      const a = 1 + r * segments, b = a + segments;
      indices.push(a + s, b + s, a + next, a + next, b + s, b + next);
    }
    const last = 1 + (rings - 2) * segments;
    indices.push(top, last + next, last + s);
  }
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(v => v * 3);
    const u = [0, 1, 2].map(j => positions[b + j] - positions[a + j]);
    const v = [0, 1, 2].map(j => positions[c + j] - positions[a + j]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const vertex of [a, b, c]) for (let j = 0; j < 3; j++) normals[vertex + j] += n[j];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(...normals.slice(i, i + 3)) || 1;
    for (let j = 0; j < 3; j++) normals[i + j] /= length;
  }
  return { positions, normals, indices, uvs };
}
