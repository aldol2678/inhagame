// PERSONAL-ROOM-V2: authored visual geometry only. The six canonical anchors and
// gameplay footprints are still owned by personal-room-layout.js, never these meshes.
import * as pc from "playcanvas";
import { box } from "../campus-render-kit.js";
import { PERSONAL_ROOM_BASIC_FURNITURE } from "./personal-room-layout.js";
import { createPersonalRoomChairModel } from "./personal-room-chair-model.js";
import { createPersonalRoomChairFallback } from "./personal-room-chair-visual.js";
import { PERSONAL_ROOM_FIXED_CHAIR_YAW } from "./personal-room-chair-design.js";

const signedPower = (value, power) => Math.sign(value) * Math.pow(Math.abs(value), power);
const PROFILES = Object.freeze({ timber: [.16, .12], mattress: [.30, .18], pillow: [.55, .40], duvet: [.42, .18], rug: [.18, .10] });

function finishGeometry(positions, indices, uvs) {
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(v => v * 3);
    const u = [0, 1, 2].map(axis => positions[b + axis] - positions[a + axis]);
    const v = [0, 1, 2].map(axis => positions[c + axis] - positions[a + axis]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const vertex of [a, b, c]) for (let axis = 0; axis < 3; axis++) normals[vertex + axis] += n[axis];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    for (let axis = 0; axis < 3; axis++) normals[i + axis] /= length;
  }
  return { positions, normals, indices, uvs };
}

// A closed superellipsoid, rather than a scaled cube: broad soft faces, curved
// shoulders and round plan corners. All vertices remain inside a unit box.
export function buildPersonalRoomSoftGeometry(profile = "pillow") {
  const [vertical, horizontal] = PROFILES[profile] ?? PROFILES.pillow;
  const segments = 24, rings = 12, positions = [0, -.5, 0], uvs = [.5, 0], indices = [];
  for (let ring = 1; ring < rings; ring++) {
    const latitude = -Math.PI / 2 + ring * Math.PI / rings;
    const radius = signedPower(Math.cos(latitude), vertical);
    for (let segment = 0; segment < segments; segment++) {
      const longitude = segment * Math.PI * 2 / segments;
      positions.push(.5 * radius * signedPower(Math.cos(longitude), horizontal),
        .5 * signedPower(Math.sin(latitude), vertical), .5 * radius * signedPower(Math.sin(longitude), horizontal));
      uvs.push(segment / segments, ring / rings);
    }
  }
  const top = positions.length / 3;
  positions.push(0, .5, 0); uvs.push(.5, 1);
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    indices.push(0, 1 + segment, 1 + next);
    for (let ring = 0; ring < rings - 2; ring++) {
      const lower = 1 + ring * segments, upper = lower + segments;
      indices.push(lower + segment, upper + segment, lower + next, lower + next, upper + segment, upper + next);
    }
    const last = 1 + (rings - 2) * segments;
    indices.push(top, last + next, last + segment);
  }
  return finishGeometry(positions, indices, uvs);
}

// Two closed gently cupped surfaces with a raised midrib. The leaf grows along
// local +Y; unlike a cluster of spheres its lance-shaped silhouette reads at range.
export function buildPersonalRoomLeafGeometry() {
  const positions = [], uvs = [], indices = [], steps = 8;
  for (let side = 0; side < 2; side++) for (let i = 0; i <= steps; i++) {
    const t = i / steps, width = Math.pow(Math.sin(t * Math.PI), .85) * .5;
    for (const across of [-1, 0, 1]) {
      positions.push(across * width, t, Math.sin(t * Math.PI) * (.18 + (across === 0 ? .18 : 0)) - side * .07);
      uvs.push((across + 1) / 2, t);
    }
  }
  const faceSize = (steps + 1) * 3;
  for (let side = 0; side < 2; side++) for (let i = 0; i < steps; i++) for (let j = 0; j < 2; j++) {
    const a = side * faceSize + i * 3 + j, b = a + 1, c = a + 3, d = c + 1;
    if (side === 0) indices.push(a, b, c, b, d, c);
    else indices.push(a, c, b, b, c, d);
  }
  for (let i = 0; i < steps; i++) for (const edge of [0, 2]) {
    const a = i * 3 + edge, b = (i + 1) * 3 + edge;
    if (edge === 0) indices.push(a, b, a + faceSize, b, b + faceSize, a + faceSize);
    else indices.push(a, a + faceSize, b, b, a + faceSize, b + faceSize);
  }
  return finishGeometry(positions, indices, uvs);
}

export function createPersonalRoomFixtures({ app, root, materials }) {
  const meshes = new Map(), loaders = [];
  let disposed = false, pending = null;
  const group = (parent, name, at = [0, 0, 0]) => {
    const entity = new pc.Entity(name);
    entity.setLocalPosition(...at); parent.addChild(entity); return entity;
  };
  const solid = (parent, name, at, size, material, type = "box") => {
    const entity = box(parent, name, at, size, materials.get(material), 0, type);
    entity.render.castShadows = material !== "contactShadow";
    entity.render.receiveShadows = true;
    return entity;
  };
  function authored(parent, name, at, size, material, key = "pillow") {
    let mesh = meshes.get(key);
    if (!meshes.has(key)) {
      mesh = null;
      if (app?.graphicsDevice && typeof pc.createMesh === "function") {
        try {
          const geometry = key === "leaf" ? buildPersonalRoomLeafGeometry() : buildPersonalRoomSoftGeometry(key);
          mesh = pc.createMesh(app.graphicsDevice, geometry.positions, {
            normals: geometry.normals, indices: geometry.indices, uvs: geometry.uvs
          });
        } catch { /* Optional authored geometry can fail without blocking room entry. */ }
      }
      meshes.set(key, mesh);
    }
    if (!mesh) {
      // Keep all semantic nodes and anchors even on the most restricted renderer.
      // Pillows/leaves stay rounded in this path; structural parts use plain boxes.
      const rounded = ["pillow", "leaf", "duvet", "mattress"].includes(key);
      const entity = solid(parent, name, at, size, material, rounded ? "sphere" : "box");
      if (key === "leaf") entity.setLocalPosition(at[0], at[1] + size[1] / 2, at[2]);
      return entity;
    }
    const entity = new pc.Entity(name);
    entity.addComponent("render", { type: "asset", meshInstances: [new pc.MeshInstance(mesh, materials.get(material))],
      castShadows: material !== "contactShadow", receiveShadows: true });
    entity.setLocalPosition(...at); entity.setLocalScale(...size); parent.addChild(entity);
    return entity;
  }
  const grounding = (parent, w, d) => authored(parent, "contact_grounding", [0, .005, 0], [w * .96, .006, d * .96], "contactShadow", "rug");

  function bed(anchor, [w, , d]) {
    grounding(anchor, w, d);
    const frame = group(anchor, "bedframe");
    for (const [ix, x] of [-1, 1].entries()) for (const [iz, z] of [-1, 1].entries())
      solid(frame, `foot_${ix}_${iz}`, [x * (w / 2 - .14), .075, z * (d / 2 - .16)], [.105, .15, .105], "woodOakDark");
    solid(frame, "under_mattress", [0, .205, 0], [w - .13, .12, d - .14], "woodOakDark");
    for (const [i, sign] of [-1, 1].entries())
      authored(frame, `side_rail_${i}`, [sign * (w / 2 - .052), .235, 0], [.104, .18, d - .04], "woodOak", "timber");
    authored(frame, "foot_rail", [0, .23, -d / 2 + .052], [w - .10, .19, .104], "woodOak", "timber");
    // Tall headboard detail stays beyond the saved bed placement edge (Z=3.2).
    authored(frame, "headboard", [0, .34, d / 2 - .015], [w - .04, .56, .03], "woodOak", "timber");
    solid(frame, "headboard_inset", [0, .40, d / 2 - .036], [w - .18, .27, .012], "woodOakDark");
    for (let i = 0; i < 5; i++) solid(frame, `headboard_slat_${i}`, [(i - 2) * (w - .25) / 5, .40, d / 2 - .041], [.19, .24, .012], "woodOak");
    const bedding = group(anchor, "bedding");
    authored(bedding, "mattress_piping", [0, .313, 0], [w - .125, .026, d - .145], "fabricLinenSeam", "mattress");
    authored(bedding, "mattress", [0, .322, 0], [w - .14, .16, d - .16], "fabricLinen", "mattress");
    // Saved bed props start at Y=.43. Keep every placeable support surface at
    // or below it; only the existing reserved pillow rectangle can rise higher.
    // Sewn binding sits below the Y=.43 owned-cushion support plane.
    authored(bedding, "duvet_edge_binding", [0, .381, -.26], [w - .05, .018, d * .68 + .018], "fabricTealLight", "duvet");
    authored(bedding, "duvet", [0, .385, -.26], [w - .065, .09, d * .68], "fabricTeal", "duvet");
    authored(bedding, "duvet_turned_edge", [0, .407, .56], [w - .095, .042, .25], "fabricTealLight", "duvet");
    authored(bedding, "duvet_fold", [0, .415, .535], [w - .15, .028, .20], "fabricTeal", "duvet");
    authored(bedding, "duvet_fold_seam", [0, .414, .438], [w - .18, .011, .018], "fabricTealLight", "timber");
    authored(bedding, "pillow_piping", [0, .438, d / 2 - .38], [w * .60 + .02, .028, .475], "fabricLinenSeam", "pillow");
    authored(bedding, "pillow", [0, .45, d / 2 - .38], [w * .60, .12, .46], "fabricLinen", "pillow");
  }

  function desk(anchor, [w, h, d]) {
    grounding(anchor, w, d);
    authored(anchor, "top", [0, h - .0325, 0], [w, .065, d], "woodOak", "timber");
    solid(anchor, "top_edge_inset", [0, h - .075, 0], [w - .08, .02, d - .055], "woodOakDark");
    for (const [ix, x] of [-1, 1].entries()) for (const [iz, z] of [-1, 1].entries()) {
      solid(anchor, `leg_${ix}_${iz}`, [x * (w / 2 - .095), (h - .08) / 2, z * (d / 2 - .075)], [.055, h - .08, .055], "woodOak");
      solid(anchor, `foot_pad_${ix}_${iz}`, [x * (w / 2 - .095), .018, z * (d / 2 - .075)], [.058, .036, .058], "graphite");
    }
    solid(anchor, "back_apron", [0, h - .16, d / 2 - .068], [w - .14, .16, .038], "woodOakDark");
    const drawers = group(anchor, "drawer_bank", [-w / 2 + .27, .22, 0]);
    solid(drawers, "carcass", [0, 0, .008], [.40, .30, d - .09], "woodOakDark");
    for (let i = 0; i < 2; i++) {
      solid(drawers, `drawer_front_${i}`, [0, (i - .5) * .143, -d / 2 + .031], [.385, .135, .035], "storageIvory");
      solid(drawers, `drawer_pull_${i}`, [0, (i - .5) * .143 + .019, -d / 2 + .009], [.11, .014, .016], "metalWarm");
    }
    // The existing closed laptop is retained; no fixed monitor, books or lamp
    // consumes one of the player's Collection-backed F0 placement rights.
    const laptop = group(anchor, "laptop", [.35, h + .015, 0]);
    authored(laptop, "laptop_base", [0, -.004, 0], [.42, .022, .28], "graphite", "timber");
    authored(laptop, "laptop_lid", [0, .007, 0], [.418, .012, .276], "laptopSilver", "timber");
    solid(laptop, "hinge", [0, .006, .132], [.31, .015, .012], "metalWarm");
  }

  function storage(anchor, [w, h, d]) {
    grounding(anchor, w, d);
    // Use the entire long face of the legacy bookshelf. All doors face -X
    // (room center); a second wardrobe elsewhere would steal editable floor.
    solid(anchor, "recessed_plinth", [0, .05, 0], [w - .09, .10, d - .09], "woodOakDark");
    solid(anchor, "back", [w / 2 - .026, (h + .10) / 2, 0], [.052, h - .10, d], "woodOakDark");
    for (const [i, sign] of [-1, 1].entries())
      solid(anchor, `side_${i}`, [0, (h + .09) / 2, sign * (d / 2 - .025)], [w, h - .09, .05], "woodOak");
    for (const [name, y] of [["top", h - .025], ["base", .12]])
      solid(anchor, name, [0, y, 0], [w, .05, d], "woodOak");
    const division = d * .22;
    solid(anchor, "cubby_divider", [0, (h + .12) / 2, division], [w - .04, h - .12, .038], "woodOak");
    const doorStart = -d / 2 + .053, doorEnd = division - .027, doorWidth = (doorEnd - doorStart - .018) / 2;
    for (let i = 0; i < 2; i++) {
      const z = doorStart + doorWidth / 2 + i * (doorWidth + .018);
      const door = group(anchor, `wardrobe_door_${i}`, [-w / 2 + .032, (h + .18) / 2, z]);
      solid(door, "oak_border", [0, 0, 0], [.045, h - .24, doorWidth], "woodOak");
      authored(door, "ivory_panel", [-.023, 0, 0], [.012, h - .31, doorWidth - .056], "storageIvory", "timber");
      const pullZ = (i === 0 ? 1 : -1) * (doorWidth / 2 - .063);
      solid(door, "pull_backplate", [-.018, -.014, pullZ], [.008, .162, .028], "woodOakDark");
      authored(door, "pull", [-.024, -.014, pullZ], [.012, .13, .014], "metalWarm", "timber");
    }
    const cubbyZ = (division + d / 2 - .05) / 2, cubbyDepth = d / 2 - .05 - division;
    for (let i = 0; i < 2; i++) {
      solid(anchor, `open_shelf_${i}`, [.012, .48 + i * .34, cubbyZ], [w - .065, .03, cubbyDepth], "woodOak");
      solid(anchor, `shelf_edge_${i}`, [-w / 2 + .04, .48 + i * .34, cubbyZ], [.016, .032, cubbyDepth], "storageIvory");
    }
  }

  function chair(anchor, [w, , d]) {
    anchor.setLocalEulerAngles(0, PERSONAL_ROOM_FIXED_CHAIR_YAW, 0);
    grounding(anchor, w * .9, d * .9);
    const fallback = createPersonalRoomChairFallback({ app, root, anchor, materials });
    loaders.push(createPersonalRoomChairModel({ app, root, anchor, fallback, materials }));
  }

  function rug(anchor, [w, , d]) {
    authored(anchor, "woven_border", [0, .008, 0], [w, .016, d], "rugBorder", "rug");
    authored(anchor, "woven_field", [0, .014, 0], [w - .17, .009, d - .17], "rugWoven", "rug");
    // Restrained woven stripes, within the original non-colliding rug footprint.
    for (const sign of [-1, 1]) for (let i = 0; i < 2; i++)
      solid(anchor, `woven_stripe_${sign}_${i}`, [0, .019, sign * (d / 2 - .19 - i * .035)], [w - .32, .002, .009], "rugBorder");
  }

  function plant(anchor, [w, , d]) {
    grounding(anchor, w, d);
    solid(anchor, "pot_foot", [0, .022, 0], [.24, .044, .24], "woodOakDark", "cylinder");
    authored(anchor, "terracotta_pot", [0, .142, 0], [.32, .255, .32], "terracotta", "timber");
    solid(anchor, "pot_lip", [0, .266, 0], [.33, .033, .33], "terracotta", "cylinder");
    solid(anchor, "soil", [0, .284, 0], [.29, .009, .29], "soil", "cylinder");
    const foliage = group(anchor, "foliage");
    solid(foliage, "central_stem", [0, .485, 0], [.013, .405, .013], "woodOakDark", "cylinder");
    for (let i = 0; i < 9; i++) {
      const yaw = i * 137.5, angle = yaw * Math.PI / 180, height = .305 + i * .034;
      const length = .205 - (i % 3) * .010, tilt = 53 - i * 2.5;
      const leaf = authored(foliage, `leaf_${i}`, [Math.cos(angle) * .018, height, -Math.sin(angle) * .018], [.145, length, .105],
        i % 3 === 0 ? "leafGreenLight" : "leafGreen", "leaf");
      leaf.setLocalEulerAngles(0, yaw, -tilt);
    }
  }

  const builders = { bed, desk, chair, bookshelf: storage, rug, plant };
  for (const item of PERSONAL_ROOM_BASIC_FURNITURE) builders[item.kind](group(root, `personal_${item.id}`, item.at), item.size);
  root.once("destroy", () => {
    disposed = true;
    for (const mesh of meshes.values()) mesh?.destroy();
    meshes.clear();
  });
  const ensureVisualAssets = () => {
    if (disposed) return Promise.resolve(false);
    if (!pending) pending = Promise.all(loaders.map(ensure => ensure()));
    return pending;
  };
  return { ensureVisualAssets };
}
