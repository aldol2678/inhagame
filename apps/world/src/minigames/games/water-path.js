// PA-G2 · Inkyung water-path T0 puzzle. Pure rules only, no World/source, wallet or persistence.
import { createPuzzleDefinition } from '../core/puzzle-runtime.js';

export const WATER_PATH_RULES_VERSION = 1;
export const WATER_PATH_PUZZLE_ID = 'puzzle.water_path';
export const WATER_PATH_KINDS = Object.freeze(['BLOCK', 'START', 'END', 'STRAIGHT', 'ELBOW', 'TEE']);
const MASK = Object.freeze({ BLOCK: 0, START: 1, END: 1, STRAIGHT: 5, ELBOW: 3, TEE: 11 });
const DIR = Object.freeze([[-1, 0], [0, 1], [1, 0], [0, -1]]); // N, E, S, W
const SEED_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function assertSize(size) {
  if (size !== 3 && size !== 4) throw new TypeError('Water path supports only 3x3 and 4x4');
}
function hashSeed(seed, size) {
  let hash = 2166136261;
  const input = 'water-path:v1:' + String(size) + ':' + seed;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}
function randomGenerator(seed, size) {
  let state = hashSeed(seed, size);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}
export function waterPathMask(kind, rotation) {
  if (!Object.hasOwn(MASK, kind) || !Number.isInteger(rotation) ||
      rotation < 0 || rotation > 3) throw new TypeError('Invalid pipe tile');
  const base = MASK[kind];
  return ((base << rotation) | (base >>> (4 - rotation))) & 15;
}
function matchingRotation(kind, requiredMask) {
  for (let rotation = 0; rotation < 4; rotation++) {
    if (waterPathMask(kind, rotation) === requiredMask) return rotation;
  }
  throw new Error('Unsatisfiable pipe orientation');
}
function direction(from, to, size) {
  const a = Math.floor(from / size), b = from % size;
  const c = Math.floor(to / size), d = to % size;
  for (let dir = 0; dir < 4; dir++) {
    if (a + DIR[dir][0] === c && b + DIR[dir][1] === d) return dir;
  }
  throw new Error('Non-adjacent path cells');
}
function assertState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      Object.keys(state).sort().join(',') !== 'size,tiles') throw new TypeError('Invalid water-path state');
  const size = state.size;
  assertSize(size);
  if (!Array.isArray(state.tiles) || state.tiles.length !== size * size) {
    throw new TypeError('Invalid water-path tile count');
  }
  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];
    if (!tile || typeof tile !== 'object' || Array.isArray(tile) ||
        Object.keys(tile).sort().join(',') !== 'kind,rotation') throw new TypeError('Invalid tile shape');
    waterPathMask(tile.kind, tile.rotation);
    if (i === 0 && tile.kind !== 'START') throw new TypeError('Missing start');
    if (i === size * size - 1 && tile.kind !== 'END') throw new TypeError('Missing goal');
    if (i > 0 && i < size * size - 1 &&
        (tile.kind === 'START' || tile.kind === 'END')) throw new TypeError('Duplicate endpoint');
  }
}
export function validateWaterPath(state) {
  assertState(state);
  const { size, tiles } = state;
  const visited = new Set([0]), queue = [0];
  let leaks = 0;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], row = Math.floor(index / size), col = index % size;
    const ports = waterPathMask(tiles[index].kind, tiles[index].rotation);
    for (let directionIndex = 0; directionIndex < 4; directionIndex++) {
      if (!(ports & (1 << directionIndex))) continue;
      const nextRow = row + DIR[directionIndex][0];
      const nextCol = col + DIR[directionIndex][1];
      if (nextRow < 0 || nextCol < 0 || nextRow >= size || nextCol >= size) {
        leaks++;
        continue;
      }
      const next = nextRow * size + nextCol;
      const opposite = (directionIndex + 2) & 3;
      const nextPorts = waterPathMask(tiles[next].kind, tiles[next].rotation);
      if (!(nextPorts & (1 << opposite))) {
        leaks++;
        continue;
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  const goalConnected = visited.has(tiles.length - 1);
  return Object.freeze({
    cleared: goalConnected && leaks === 0,
    goalConnected, leaks, activeTiles: visited.size
  });
}
function makeLevel(size, seed) {
  const random = randomGenerator(seed, size);
  const path = [0];
  let row = 0, col = 0;
  while (row < size - 1 || col < size - 1) {
    if (row === size - 1) col++;
    else if (col === size - 1) row++;
    else if (random() & 1) row++;
    else col++;
    path.push(row * size + col);
  }
  const tiles = Array.from({length: size * size}, () => {
    const kind = ['BLOCK', 'BLOCK', 'ELBOW', 'STRAIGHT', 'TEE'][random() % 5];
    return {kind, rotation: kind === 'BLOCK' ? 0 : random() & 3};
  });
  for (let i = 0; i < path.length; i++) {
    const previous = i > 0 ? direction(path[i], path[i - 1], size) : null;
    const next = i < path.length - 1 ? direction(path[i], path[i + 1], size) : null;
    const needed = (previous === null ? 0 : 1 << previous) |
      (next === null ? 0 : 1 << next);
    const kind = i === 0 ? 'START' : i === path.length - 1 ? 'END' :
      ((previous + 2) % 4 === next ? 'STRAIGHT' : 'ELBOW');
    const rotation = matchingRotation(kind, needed);
    // The first tile deliberately cannot point in its solved direction.
    tiles[path[i]] = {kind, rotation: (rotation + 1 + (random() % 3)) & 3};
  }
  // A disconnected decoy network is allowed; active leaks never count as success.
  const level = {size, tiles};
  if (validateWaterPath(level).cleared) {
    // Deterministic defensive fallback for rare accidental alternative routes.
    const start = tiles[0];
    for (let offset = 1; offset <= 3 && validateWaterPath(level).cleared; offset++) {
      start.rotation = (start.rotation + 1) & 3;
    }
    if (validateWaterPath(level).cleared) throw new Error('Initial water path unexpectedly solved');
  }
  return level;
}
export function createWaterPathDefinition({size = 3, seed = 'inkyung.practice.01'} = {}) {
  assertSize(size);
  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) throw new TypeError('Invalid water-path seed');
  return createPuzzleDefinition({
    puzzleId: WATER_PATH_PUZZLE_ID,
    rulesVersion: WATER_PATH_RULES_VERSION,
    seed, initialState: makeLevel(size, seed),
    maxMoves: 300, undoLimit: 50,
    applyAction(state, action) {
      if (!action || typeof action !== 'object' || Array.isArray(action) ||
          Object.keys(action).sort().join(',') !== 'col,row,type' ||
          action.type !== 'ROTATE_TILE' ||
          !Number.isInteger(action.row) || !Number.isInteger(action.col) ||
          action.row < 0 || action.col < 0 ||
          action.row >= state.size || action.col >= state.size) {
        throw new TypeError('Invalid water-path rotation action');
      }
      const index = action.row * state.size + action.col;
      if (state.tiles[index].kind === 'BLOCK') throw new Error('Blocked tile cannot rotate');
      return {
        size: state.size,
        tiles: state.tiles.map((tile, i) => i === index ?
          {kind: tile.kind, rotation: (tile.rotation + 1) & 3} :
          {kind: tile.kind, rotation: tile.rotation})
      };
    },
    evaluate(state) {
      const result = validateWaterPath(state);
      return {cleared: result.cleared, failed: false};
    }
  });
}
