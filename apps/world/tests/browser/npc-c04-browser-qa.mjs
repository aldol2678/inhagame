import assert from 'node:assert/strict';
export const C04_VIEWPORTS = Object.freeze({
  desktop: { width: 1280, height: 800, mobile: false },
  portrait: { width: 390, height: 844, mobile: true },
  landscape: { width: 844, height: 390, mobile: true }
});
export function assertC04Hosted(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'C04 pixels require the approved hosted runner');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request');
  assert.match(env.EXPECTED_C04_HEAD || '', /^[0-9a-f]{40}$/);
  assert.ok(Object.hasOwn(C04_VIEWPORTS, env.C04_VIEWPORT));
  assert.equal(env.WORLD_SMOKE_DISABLE_WEBGPU, '1');
  assert.equal(env.WORLD_SMOKE_BROWSER, 'chrome');
}
export const angleError = (a,b) => Math.abs(((a-b+540)%360)-180);
export function assertC04Frame(frame, { id, phase }) {
  assert.equal(frame.actor.id,id);
  assert.equal(frame.actor.phase, phase);
  assert.equal(frame.actor.visible,true);
  assert.equal(frame.render.enabled,true);
  assert.ok(frame.renderedFrames>=3,'at least three real postrender events');
  assert.equal(frame.clock.state,'SYNCED');
  assert.equal(frame.count,46);
  const box=frame.avatarBounds;
  assert.ok(box&&box.height>=60,'NPC is large enough for independent pixel review');
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=frame.viewport.width&&box.y+box.height<=frame.viewport.height,'whole NPC body fits the viewport');
  assert.ok(frame.hud.every(h=>box.x+box.width<=h.x||h.x+h.width<=box.x||box.y+box.height<=h.y||h.y+h.height<=box.y),'HUD does not cover the reviewed NPC');
  assert.ok(frame.screen.x>=0 && frame.screen.x<=frame.viewport.width && frame.screen.y>=0 && frame.screen.y<=frame.viewport.height,'NPC is in the captured viewport');
  if(phase==='MOVING') {
    assert.equal(frame.actor.moving,true);
    assert.ok(Math.hypot(frame.render.position.x-frame.actor.position.x,frame.render.position.z-frame.actor.position.z)<.02,'moving renderer follows actual shared position');
  } else if(id==='INKYUNG-NPC-009') {
    assert.equal(frame.actor.activity,'PHOTO');
    assert.ok(angleError(frame.render.heading,frame.photoTargetYaw)<1,'photographer actually renders toward the pond');
    assert.equal(frame.photoPropVisible,true,'actual photo prop is loaded and visible');
    assert.ok(frame.photoLensAlignment>.98,'actual camera lens faces the pond');
    assert.ok(Math.abs(frame.photoLensVertical)<.15,'actual camera lens is nearly level');
  } else {
    assert.equal(frame.actor.activity,'RESTING');
    assert.ok(Math.hypot(frame.render.position.x-frame.seat.position.x-.02*Math.sin(frame.seat.yaw*Math.PI/180),frame.render.position.z-frame.seat.position.z-.02*Math.cos(frame.seat.yaw*Math.PI/180))<.002,'rendered body uses the physical seat');
    assert.ok(frame.seatGeometry?.triangles>0,'actual body mesh triangles are inspected');
    assert.equal(frame.seatGeometry.penetrations,0,'body meshes do not intersect the seat slab');
    assert.ok(Math.abs(frame.seatGeometry.contactGap)<.002,'actual clothed silhouette touches the slab');
    assert.ok(angleError(frame.render.heading,frame.seat.yaw)<1,'seated model faces outward');
  }
}
