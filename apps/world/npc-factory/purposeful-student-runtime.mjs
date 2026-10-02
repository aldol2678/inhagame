import * as pc from 'playcanvas';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { SEAT_TOP_Y } from '../src/seat-anchors.js';
import { createHumanAvatar } from './dev-human-avatar.mjs';
import { npcNameplateOffset, npcSeatAnchorHeight } from './npc-dimensions.mjs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { createPurposefulStudent, STUDENT_ID } from './purposeful-student-state.mjs';
import { campusStudentDestinations } from './purposeful-student-destinations.mjs';

const appearance = Object.freeze({
  height: 1, presentation: 'female', skin_tone: 1, hair_style: 'ponytail',
  hair_color: '#29242c', outfit_style: 'hoodie', outfit_color: '#4169a7',
  accent_color: '#e2b956', accessory: 'backpack'
});

export function createPurposefulStudentRuntime({ app, campusRoot, player, orbit, isInsideRoom = () => false }) {
  const destinations = campusStudentDestinations();
  const spawn = destinations['poi.main-gate'].position;
  const navigator = createNpcNavigator(null, { additionalAnchors: [spawn, ...Object.values(destinations).map(p => p.position)] });
  const student = createPurposefulStudent({ spawn, destinations, navigator });
  const actor = { id: STUDENT_ID, name: '캠퍼스 학생 A' };
  const visual = createHumanAvatar(campusRoot, actor, appearance);
  visual.marker.enabled = false;

  const panel = document.createElement('section');
  panel.id = 'purposeful-student-debug';
  panel.setAttribute('aria-label', '생활 NPC 개발 상태');
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:65;max-width:min(320px,calc(100vw - 24px));padding:9px 12px;background:#14262bea;color:#fff;border:1px solid #e2b956;border-radius:9px;font:13px/1.45 system-ui,sans-serif;pointer-events:auto';
  panel.innerHTML = '<strong>캠퍼스 학생 A · P0-B</strong><div data-status></div><button type="button" data-advance>시연 시간 +60초</button>';
  document.body.appendChild(panel);
  const statusText = panel.querySelector('[data-status]');
  const advanceButton = panel.querySelector('[data-advance]');
  advanceButton.style.cssText = 'margin-top:5px;padding:4px 8px;color:white;background:#305d69;border:1px solid #98c8c4;border-radius:5px';
  advanceButton.addEventListener('click', () => student.tick(60));

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;z-index:62;transform:translate(-50%,-100%);padding:4px 8px;background:#102a31e8;color:#fff;border:1px solid #e2b956;border-radius:6px;font:700 12px system-ui,sans-serif;white-space:nowrap;pointer-events:none';
  document.body.appendChild(label);
  const projected = new pc.Vec3();
  let elapsed = 0;
  function render(dt) {
    const s = student.status();
    const destination = destinations[s.destination];
    const resting = s.phase === 'ACTING' && s.activity === 'RESTING';
    const eating = s.phase === 'ACTING' && s.activity === 'EATING';
    const point = resting ? destination.seat.position : s.position;
    const time = elapsed * 8;
    const bob = s.moving ? Math.abs(Math.sin(time)) * .035 : Math.sin(time * .25) * .01;
    const y = roadviewGroundHeight(point.x, point.z) +
      (resting ? SEAT_TOP_Y - npcSeatAnchorHeight(appearance.height) : bob);
    visual.avatar.setLocalPosition(point.x, y, point.z);
    visual.avatar.setLocalEulerAngles(0, resting ? destination.seat.yaw : s.heading, 0);
    visual.arms.forEach((arm, index) => arm.setLocalEulerAngles(
      s.moving ? Math.sin(time) * (index ? -23 : 23) : eating ? -28 + Math.sin(time * .4) * 10 : resting ? -12 : 0, 0, 0));
    visual.legs.forEach((leg, index) => leg.setLocalEulerAngles(
      resting ? -40 : s.moving ? Math.sin(time) * (index ? 27 : -27) : 0, 0, 0));
    visual.avatar.enabled = s.visible && !isInsideRoom();
    const action = s.phase === 'MOVING' ? `${destination.label}로 이동 중` :
      s.phase === 'ACTING' ? ({ STUDY: '수업 중', EATING: '식사 중', RESTING: '휴식 중', EXITING: '하교 중' }[s.activity]) :
      s.phase === 'DONE' ? '하루 일정 완료' : s.phase === 'FAILED' ? '이동 실패 · 정문으로 복귀' : s.phase;
    label.textContent = `캠퍼스 학생 A · ${action}`;
    const playerPos = player.getLocalPosition();
    const close = Math.hypot(playerPos.x - s.position.x, playerPos.z - s.position.z) < 35;
    if (close && visual.avatar.enabled) {
      const world = visual.avatar.getPosition();
      projected.set(world.x, world.y + npcNameplateOffset(appearance.height), world.z);
      const screen = orbit.camera.camera.worldToScreen(projected);
      const rect = app.graphicsDevice.canvas.getBoundingClientRect();
      label.hidden = screen.x < 0 || screen.y < 0 || screen.x > rect.width || screen.y > rect.height;
      label.style.left = `${screen.x + rect.left}px`;
      label.style.top = `${screen.y + rect.top}px`;
    } else label.hidden = true;
    statusText.textContent = `Need ${s.currentNeed ?? '—'} · Goal ${s.currentGoal ?? '—'}\nDestination ${s.destination ?? '—'} · Phase ${s.phase} · ${s.visible ? '야외' : '실내'} · ${s.scheduleIndex + 1}/5`;
    statusText.style.whiteSpace = 'pre-line';
    advanceButton.disabled = s.phase === 'DONE' || s.phase === 'FAILED';
  }
  function update(dt) {
    const step = Math.min(Math.max(dt, 0), .05);
    elapsed += step;
    student.tick(step);
    render(step);
  }
  render(0);
  app.on('update', update);
  const api = {
    getStatus: student.status,
    advance: seconds => { student.tick(seconds); render(0); return student.status(); },
    destinations,
    destroy: () => { app.off('update', update); visual.avatar.destroy(); label.remove(); panel.remove(); }
  };
  window.__CAMPUS_LIFE_P0A__ = api;
  return api;
}
