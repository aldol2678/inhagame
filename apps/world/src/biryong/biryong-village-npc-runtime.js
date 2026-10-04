// Visual/runtime adapter for the eight Biryong Village P0 NPCs.
// Dialogue, trust, quest authority and generative AI are deliberately out of scope here.
import * as pc from "playcanvas";
import { createHumanAvatar } from "../../npc-factory/dev-human-avatar.mjs";
import { npcNameplateOffset } from "../../npc-factory/npc-dimensions.mjs";
import { createPurposefulStudent } from "../../npc-factory/purposeful-student-state.mjs";
import { createNpcWorldClock } from "../../npc-factory/npc-world-clock.mjs";
import { worldScheduleAt } from "../../npc-factory/npc-world-time-contract.mjs";
import {
  BIRYONG_VILLAGE_NPC_DESTINATIONS,
  BIRYONG_VILLAGE_NPC_PERIODS,
  BIRYONG_VILLAGE_NPC_ROSTER
} from "./biryong-village-npc-contract.js";
import { createBiryongVillageNpcNavigator } from "./biryong-village-npc-navigation.js";

const activityLabels = Object.freeze({
  CARGO_CHECK: "화물 확인",
  DELIVERY: "배송",
  MEAL: "식사",
  HOME: "귀가",
  MAINTENANCE: "설비 점검",
  REPAIR: "수리",
  MAP_SKETCH: "지도 스케치",
  TEA_SHOP: "찻집 일",
  SOCIAL: "주민들과 이야기",
  SKETCH_OUTER: "외곽 답사",
  RECORD_WATER: "수로 기록",
  ERRAND: "심부름",
  FARM: "농사",
  SELL_PRODUCE: "농산물 정리",
  RESIDENT_AFFAIRS: "주민 안건",
  RESEARCH: "연구",
  CRAFT: "제작",
  MENTOR: "공방 지도",
  PATROL: "순찰",
  SURVEY: "생태 조사",
  FIELD_MEAL: "현장 식사",
  REPORT: "현장 보고",
  SHOPPING: "장보기",
  PREPARE_INN: "여관 준비",
  SERVE_MEAL: "식사 장사"
});

function makeLabel(name, role) {
  const label = document.createElement("div");
  label.className = "biryong-npc-nameplate";
  label.style.cssText = [
    "position:fixed","z-index:62","transform:translate(-50%,-100%)",
    "padding:4px 7px","border-radius:7px","border:1px solid #d9bd72",
    "background:#162923e8","color:#fff","font:700 12px/1.2 system-ui,sans-serif",
    "white-space:nowrap","pointer-events:none","text-align:center"
  ].join(";");
  label.innerHTML = `<strong></strong><small style="display:block;color:#cfd9cc;font:600 9px/1.15 system-ui,sans-serif"></small>`;
  label.querySelector("strong").textContent = name;
  label.querySelector("small").textContent = role;
  label.hidden = true;
  document.body.appendChild(label);
  return label;
}

export function createBiryongVillageNpcRuntime({
  app, root, player, camera,
  getActive = () => true,
  clock = createNpcWorldClock()
} = {}) {
  if (!app || !root || !player || !camera?.camera) throw new TypeError("Biryong NPC runtime dependencies required");

  const navigator = createBiryongVillageNpcNavigator();
  const destinations = Object.fromEntries(Object.entries(BIRYONG_VILLAGE_NPC_DESTINATIONS)
    .map(([key, value]) => [key, { ...value, position: { ...value.position } }]));

  const actors = BIRYONG_VILLAGE_NPC_ROSTER.map((definition, index) => {
    const spawn = destinations[definition.schedule[0].destination].position;
    const controller = createPurposefulStudent({
      id: definition.id,
      spawn,
      destinations,
      schedule: definition.schedule,
      navigator,
      speed: 1.05 + (index % 3) * 0.08,
      holdAtActivity: true,
      startHidden: definition.schedule[0].sink === true
    });
    const visual = createHumanAvatar(root, { id: definition.id, name: definition.name }, definition.appearance);
    visual.marker.enabled = false;
    const label = makeLabel(definition.name, definition.publicRole);
    return { definition, controller, visual, label };
  });

  const projected = new pc.Vec3();
  let lastPeriodIndex = 0;
  let lastPeriod = BIRYONG_VILLAGE_NPC_PERIODS[0];
  let elapsed = 0;
  let disposed = false;

  function applySharedPeriod(index, period) {
    if (!Number.isInteger(index) || index < 0 || index >= BIRYONG_VILLAGE_NPC_PERIODS.length) return false;
    lastPeriodIndex = index;
    lastPeriod = period ?? BIRYONG_VILLAGE_NPC_PERIODS[index];
    for (const actor of actors) actor.controller.setScheduleIndex(index);
    return true;
  }

  function syncPeriod() {
    const now = clock.now();
    if (!Number.isFinite(now)) return false;
    const shared = worldScheduleAt(now);
    if (shared.index !== lastPeriodIndex) applySharedPeriod(shared.index, shared.period);
    else lastPeriod = shared.period;
    return true;
  }

  function renderActor(actor, dt) {
    const state = actor.controller.status(false);
    const active = getActive() === true;
    const visible = active && state.visible;
    const t = elapsed * 8 + Number(actor.definition.id.slice(-3)) * 0.7;
    const bob = state.moving ? Math.abs(Math.sin(t)) * 0.035 : Math.sin(t * 0.2) * 0.008;

    actor.visual.avatar.setLocalPosition(state.position.x, bob, state.position.z);
    actor.visual.avatar.setLocalEulerAngles(0, state.heading, 0);
    actor.visual.arms.forEach((arm, index) => arm.setLocalEulerAngles(
      state.moving ? Math.sin(t) * (index ? -22 : 22) : 0, 0, 0));
    actor.visual.legs.forEach((leg, index) => leg.setLocalEulerAngles(
      state.moving ? Math.sin(t) * (index ? 26 : -26) : 0, 0, 0));
    actor.visual.avatar.enabled = visible;

    if (!visible) {
      actor.label.hidden = true;
      return;
    }
    const playerPos = player.getLocalPosition();
    if (Math.hypot(playerPos.x - state.position.x, playerPos.z - state.position.z) > 22) {
      actor.label.hidden = true;
      return;
    }
    const world = actor.visual.avatar.getPosition();
    projected.set(world.x, world.y + npcNameplateOffset(actor.definition.appearance.height), world.z);
    const screen = camera.camera.worldToScreen(projected);
    const rect = app.graphicsDevice.canvas.getBoundingClientRect();
    const onscreen = screen.z > 0 && screen.x >= 0 && screen.y >= 0 && screen.x <= rect.width && screen.y <= rect.height;
    actor.label.hidden = !onscreen;
    if (!onscreen) return;
    actor.label.style.left = `${screen.x + rect.left}px`;
    actor.label.style.top = `${screen.y + rect.top}px`;
    const detail = actor.label.querySelector("small");
    const action = state.phase === "MOVING" ? "이동 중" : activityLabels[state.activity] ?? actor.definition.publicRole;
    detail.textContent = `${actor.definition.publicRole} · ${action}`;
  }

  function update(dt) {
    if (disposed) return;
    const step = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
    elapsed += step;
    clock.refreshIfDue();
    syncPeriod();
    for (const actor of actors) {
      actor.controller.tick(step);
      renderActor(actor, step);
    }
  }

  void clock.sync().then(() => syncPeriod());
  app.on("update", update);

  const status = () => Object.freeze({
    count: actors.length,
    active: getActive() === true,
    period: lastPeriod,
    periodIndex: lastPeriodIndex,
    clock: clock.status(),
    npcs: actors.map(({ definition, controller }) => {
      const state = controller.status(false);
      const destination = BIRYONG_VILLAGE_NPC_DESTINATIONS[state.destination] ?? null;
      return Object.freeze({
        id: definition.id,
        name: definition.name,
        role: definition.publicRole,
        faction: definition.faction,
        destination: state.destination,
        zoneId: destination?.zoneId ?? null,
        phase: state.phase,
        activity: state.activity,
        visible: state.visible,
        moving: state.moving,
        position: Object.freeze({ ...state.position })
      });
    })
  });

  return Object.freeze({
    status,
    syncPeriod,
    setPeriodForTest(index) {
      return applySharedPeriod(index, BIRYONG_VILLAGE_NPC_PERIODS[index]);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      app.off("update", update);
      clock.dispose();
      for (const actor of actors) {
        actor.visual.avatar.destroy();
        actor.label.remove();
      }
    }
  });
}
