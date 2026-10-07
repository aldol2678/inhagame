// PlayCanvas view for fishing-visuals. Models use the existing registry loader; containers/textures
// remain asset-registry owned. This view owns only entities and cloned/temporary materials.
import { createEquipmentModelLoader } from '../appearance/equipment-asset-loader.js';
import { HUMAN_HEIGHT } from '../player-dimensions.js';
import { metersToWorld } from '../world-scale.js';
import { FISHING_ASSETS, FISHING_MODEL_REGISTRY, createFishingPresentation } from './fishing-visuals.js';

export function createFishingRenderView({ pc, app, parent, player, frame, camera, loadModel } = {}) {
  if (!frame || !parent) throw new Error('FISHING_ANCHOR_UNAVAILABLE');
  const grip = new pc.Entity('Activity_Grip_R');
  // Body-height space, outside the differently scaled fallback/GLB avatar. Never occupies ACCESSORY.
  grip.setLocalPosition(0.22 * HUMAN_HEIGHT, 0.62 * HUMAN_HEIGHT, 0.12 * HUMAN_HEIGHT);
  frame.addChild(grip);
  const root = new pc.Entity('Fishing_Water_Visuals');
  parent.addChild(root);
  const models = {}, ownedMaterials = new Set();
  const inverse = new pc.Mat4(), tipLocal = new pc.Vec3(), fishPosition = new pc.Vec3();
  const orientation = new pc.Mat4(), yawMatrix = new pc.Mat4(), gripRotation = new pc.Quat();
  const cameraLocal = new pc.Vec3();
  const lineColor = new pc.Color(0.86, 0.91, 0.88);
  let disposed = false, snapshot = null, failures = 0;

  for (const key of ['rod', 'float', 'fish']) {
    Promise.resolve().then(() => disposed ? null : loadModel(key)).then(entity => {
      if (disposed) { entity?.destroy(); return; }
      if (!entity) throw new Error('EMPTY_FISHING_MODEL');
      const clones = new Map();
      try {
        // COLOR_0 is baked in the approved GLBs. Change only instance-owned material clones.
        for (const component of entity.findComponents('render')) for (const mesh of component.meshInstances) {
          if (!clones.has(mesh.material)) {
            const material = mesh.material.clone();
            clones.set(mesh.material, material); ownedMaterials.add(material);
            material.diffuseVertexColor = true;
            material.update();
          }
          mesh.material = clones.get(mesh.material);
        }
        const scale = metersToWorld(1);
        entity.setLocalScale(scale, scale, scale);
        entity.enabled = false;
        (key === 'rod' ? grip : root).addChild(entity);
        models[key] = entity;
        if (snapshot) render(snapshot);
      } catch (error) {
        delete models[key]; entity.destroy();
        for (const material of clones.values()) { material.destroy(); ownedMaterials.delete(material); }
        throw error;
      }
    }).catch(() => { if (!disposed) failures += 1; });
  }

  function sprite(key, size, upright = false) {
    const entity = new pc.Entity(`Fishing_${key === 'ripple' ? 'Ripple' : 'Splash'}`);
    root.addChild(entity);
    entity.addComponent('render', { type: 'plane', castShadows: false, receiveShadows: false });
    entity.setLocalScale(size, size, size);
    entity.enabled = false;
    const material = new pc.StandardMaterial();
    ownedMaterials.add(material);
    material.emissive.set(1, 1, 1);
    material.diffuse.set(0, 0, 0);
    material.opacityMapChannel = 'a';
    material.blendType = pc.BLEND_NORMAL;
    material.depthTest = true;
    material.depthWrite = false;
    material.cull = pc.CULLFACE_NONE;
    entity.render.material = material;
    let ready = false;
    app.assets.loadFromUrl(FISHING_ASSETS[key].url, 'texture', (error, asset) => {
      if (disposed) return;
      if (error || !asset?.resource) { failures += 1; return; }
      const texture = asset.resource;
      texture.addressU = texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
      texture.minFilter = texture.magFilter = pc.FILTER_LINEAR;
      texture.mipmaps = false;
      texture.srgb = true;
      material.emissiveMap = material.opacityMap = texture;
      material.update(); ready = true;
      if (snapshot) render(snapshot);
    });
    return {
      entity,
      update(at, frameIndex) {
        entity.enabled = ready && frameIndex !== null;
        if (!entity.enabled) return;
        // Sprite JSON rects are top-left origin; shader UVs start at bottom-left. Half-pixel inset.
        const x = (frameIndex % 4) / 4 + 0.5 / 1024;
        const y = (1 - Math.floor(frameIndex / 4)) / 2 + 0.5 / 512;
        material.emissiveMapTiling.set(255 / 1024, 255 / 512);
        material.opacityMapTiling.set(255 / 1024, 255 / 512);
        material.emissiveMapOffset.set(x, y); material.opacityMapOffset.set(x, y); material.update();
        entity.setLocalPosition(at.x, at.y + (upright ? (0.7421875 - 0.5) * size : metersToWorld(0.005)), at.z);
        if (upright) {
          // A world lookAt quaternion loses the campus reflection. Solve in its local coordinates.
          inverse.copy(parent.getWorldTransform()).invert().transformPoint(camera.getPosition(), cameraLocal);
          const yaw = Math.atan2(cameraLocal.x - at.x, cameraLocal.z - at.z) * 180 / Math.PI;
          entity.setLocalEulerAngles(90, yaw, 0);
        }
      }
    };
  }
  let ripple, splash;
  try {
    ripple = sprite('ripple', metersToWorld(0.75));
    splash = sprite('splash', metersToWorld(0.65), true);
  } catch (error) { destroy(); throw error; }

  function render(next) {
    if (disposed) return;
    snapshot = next;
    const { target, spot, showFish, castProgress, reelProgress } = next;
    const rod = models.rod, float = models.float, fish = models.fish;
    // Cancel the frame's body rotation with matrices: Euler y alone folds after ±90 degrees.
    inverse.copy(frame.getWorldTransform()).invert();
    orientation.mul2(inverse, parent.getWorldTransform());
    yawMatrix.setFromEulerAngles(0, spot.facingYaw * 180 / Math.PI, 0);
    orientation.mul2(orientation, yawMatrix);
    grip.setLocalRotation(gripRotation.setFromMat4(orientation));
    if (rod) {
      rod.enabled = true;
      rod.setLocalEulerAngles(showFish ? 60 - reelProgress * 35 : 25 + castProgress * 35, 0, 0);
    }
    const tip = rod?.findByName('Line_Tip');
    if (tip) inverse.copy(parent.getWorldTransform()).invert().transformPoint(tip.getPosition(), tipLocal);
    const start = tip ? tipLocal : target;
    if (float) {
      float.enabled = !showFish;
      float.setLocalPosition(start.x + (target.x - start.x) * castProgress,
        start.y + (target.y - start.y) * castProgress + Math.sin(castProgress * Math.PI) * metersToWorld(0.3) + next.floatOffset,
        start.z + (target.z - start.z) * castProgress);
    }
    if (fish) {
      fish.enabled = showFish && Boolean(tip);
      if (fish.enabled) {
        fish.setLocalEulerAngles(-90, spot.facingYaw * 180 / Math.PI, 0);
        // Fish's +Z mouth socket becomes +Y when hanging. Attach Catch_Line, not mesh centre.
        const socket = fish.findByName('Catch_Line');
        const mouthOffset = (socket?.getLocalPosition().z ?? 0) * metersToWorld(1);
        fishPosition.set(target.x + (start.x - target.x) * reelProgress,
          target.y + (start.y - target.y) * reelProgress - mouthOffset,
          target.z + (start.z - target.z) * reelProgress);
        fish.setLocalPosition(fishPosition);
      }
    }
    ripple.update(target, !showFish && castProgress >= 1 ? next.rippleFrame : null);
    splash.update(target, !showFish ? next.splashFrame : null);
    const end = showFish ? fish?.enabled && fish.findByName('Catch_Line') : float?.findByName('Line_Attach');
    if (tip && end) app.drawLine(tip.getPosition(), end.getPosition(), lineColor, true);
  }
  function destroy() {
    if (disposed) return;
    disposed = true; snapshot = null;
    grip.destroy(); root.destroy();
    for (const material of ownedMaterials) material.destroy();
    ownedMaterials.clear();
  }
  return Object.freeze({
    render, destroy,
    status: () => ({ disposed, loaded: Object.keys(models), failures })
  });
}

export function createFishingRenderer({ pc, app, parent, player, character, camera, fishing, assetShadow = null } = {}) {
  const loadModel = createEquipmentModelLoader({ app, registry: FISHING_MODEL_REGISTRY, assetShadow });
  return createFishingPresentation({ fishing, createView: () => createFishingRenderView({
    pc, app, parent, player, camera, loadModel,
    frame: character.getEquipmentAnchor('ACCESSORY')?.parent
  }) });
}
