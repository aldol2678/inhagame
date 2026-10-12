// Conservative geometry diagnostics accompany real screenshots; never substitute for pixels.
import * as pc from 'playcanvas';

export function inspectVendorFace({ sceneRoot, visual, camera, canvas }) {
  const avatar = visual?.avatar, face = visual?.face;
  if (!avatar?.enabled || !face?.head || !face.eyes?.length || !face.mouth) return { available: false };
  const cameraPoint = camera.getPosition(), rect = canvas.getBoundingClientRect();
  const own = new Set([avatar, ...avatar.find(entity => entity !== avatar)]);
  const blockers = sceneRoot.findComponents('render').filter(render => render.entity.enabled && !own.has(render.entity));
  const samples = [...face.eyes, face.mouth].map(entity => {
    const point = entity.getPosition(), projected = camera.camera.worldToScreen(point);
    const direction = new pc.Vec3().sub2(point,cameraPoint), distance = direction.length(); direction.normalize();
    const ray = new pc.Ray(cameraPoint.clone(),direction), hit = new pc.Vec3(), blockingMeshes = [];
    for (const render of blockers) for (const instance of render.meshInstances) {
      if (instance.visible === false || !instance.aabb.intersectsRay(ray,hit)) continue;
      const hitDistance = cameraPoint.distance(hit);
      if (hitDistance > .03 && hitDistance < distance-.015) blockingMeshes.push({name:render.entity.name,distance:hitDistance});
    }
    const x=rect.left+projected.x,y=rect.top+projected.y;
    return {name:entity.name,screen:{x,y,z:projected.z},blockingMeshes,
      dom:document.elementFromPoint(x,y)?.id??null,
      inViewport:projected.z>0&&x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom};
  });
  const forward = avatar.getWorldTransform().transformVector(new pc.Vec3(0,0,1)).normalize();
  const towardCamera = new pc.Vec3().sub2(cameraPoint,face.head.getPosition()).normalize();
  return {available:true,facingCamera:forward.dot(towardCamera),samples,
    unobscured:samples.every(sample=>sample.inViewport&&sample.blockingMeshes.length===0)};
}
