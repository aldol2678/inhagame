// PlayCanvas avatar for one remote player: the existing 인덕이/안뇽이 character model under the
// campus frame plus a DOM nameplate in the local nameplate style. Visual only: no colliders, and
// nothing here is read by PlayerController or world-collision.
// Multiplayer Equipment Projection P0: the remote player's Presence equipment drives the SAME
// Equipment Projection the local player uses, through a per-session in-memory source, onto the
// character's own equipment anchors. Equipment changes never recreate the avatar.

import * as pc from "playcanvas";
import { createCharacter } from "../character-model.js";
import { Anim } from "../network/protocol.js";
import { emoteIsActive } from "./emotes.js";
import { remoteMountState } from "../mounts/mount-kinds.js";
import { renderStaffName } from "../staff-badges.js";
import { createEquipmentProjection } from "../appearance/equipment-projection.js";
import { createEquipmentModelLoader } from "../appearance/equipment-asset-loader.js";
import { createRemoteEquipmentSource } from "./remote-equipment-source.js";

const MOVING = new Set([Anim.WALK, Anim.RUN, Anim.FLY]);
const NAMEPLATE_MAX_DISTANCE = 90;

export function createRemoteAvatarFactory({ app, parent, camera, canvas, doc = document, onInspect = null,
  // One loader for every remote avatar: PlayCanvas reuses a loaded container per URL, so N players
  // wearing the same cap download its GLB once and each get their own render instance.
  loadEquipmentModel = createEquipmentModelLoader({ app }) }) {
  const point = new pc.Vec3();
  return (initial) => {
    const entity = new pc.Entity(`RemotePlayer_${initial.sessionId}`);
    entity.tags.add("remote-player");
    parent.addChild(entity);
    const character = createCharacter(app, entity);
    const equipmentSource = createRemoteEquipmentSource({ sessionId: initial.sessionId });
    equipmentSource.set(initial.equipment);
    const equipment = createEquipmentProjection({
      loadout: equipmentSource,
      getAnchor: (slot) => character.getEquipmentAnchor(slot),
      loadModel: loadEquipmentModel
    });
    const plate = doc.createElement("div");
    plate.className = "nameplate remote-nameplate";
    plate.dataset.session = initial.sessionId;
    // Social S1-C1: the nameplate is the inspect target (a DOM tap never reaches the camera).
    if (onInspect) {
      plate.setAttribute("role", "button");
      plate.setAttribute("tabindex", "0");
      plate.classList.add("inspectable");
      plate.addEventListener("pointerdown", (event) => event.stopPropagation());
      plate.addEventListener("click", (event) => { event.stopPropagation(); onInspect(initial.sessionId); });
      plate.addEventListener("keydown", (event) => { if (event.code === "Enter") onInspect(initial.sessionId); });
    } else {
      plate.setAttribute("aria-hidden", "true");
    }
    doc.body.appendChild(plate);
    const bubble = doc.createElement("div");
    bubble.className = "chat-bubble";
    bubble.setAttribute("aria-hidden", "true");
    bubble.hidden = true;
    doc.body.appendChild(bubble);
    let bubbleText = null;
    let name = null;
    let nameUserId = null;
    let mounted = null;
    let mountId = null;

    return {
      entity,
      update(sample, dtSec) {
        const { pose, anim } = sample;
        // Same session, new Presence equipment: the projection reconciles only the changed slots.
        equipmentSource.set(sample.equipment);
        entity.setLocalPosition(pose.x, pose.y, pose.z);
        entity.setLocalEulerAngles(0, pose.yaw, 0);
        // The character reads entity.mountKind like the local player's, so a bike rider shows the
        // rider bike and a dragon rider the dragon. Old senders (FLY, no mount) resolve to dragon.
        const { mounted: fly, mountId: nextMountId } = remoteMountState(sample);
        if (fly !== mounted || nextMountId !== mountId) {
          mounted = fly;
          mountId = nextMountId;
          entity.mountKind = nextMountId;
          character.setMounted(fly);
        }
        // Exactly the action that arrived; expired, moved or airborne-incompatible emotes stop.
        const emote = sample.emote && emoteIsActive(sample.emote) ? sample.emote : null;
        character.update(Math.min(dtSec, 0.05), {
          mounted: fly,
          // FLY does not encode grounded/hover separately. Use received velocity for
          // Annyongi forward pose, and keep its wings deployed until dismount.
          moving: nextMountId === 'annyongi' ? Math.hypot(pose.vx ?? 0, pose.vz ?? 0) > .1 : MOVING.has(anim),
          grounded: anim !== Anim.AIR && nextMountId !== 'annyongi',
          emote: anim === Anim.SIT ? null : emote,
          seated: anim === Anim.SIT
        });
        plate.dataset.emote = emote?.id ?? "";
        if (sample.displayName !== name || sample.userId !== nameUserId) {
          name = sample.displayName;
          nameUserId = sample.userId;
          renderStaffName(plate, name, nameUserId, doc);
          if (onInspect) plate.setAttribute("aria-label", `${name} 프로필 보기`);
        }
        plate.dataset.anim = anim;
        plate.dataset.presence = sample.presence;

        const world = entity.getPosition();
        // Same label height as the local nameplate (character scale from #108).
        point.set(world.x, world.y + character.nameplateHeight, world.z);
        const cameraPosition = camera.getPosition();
        const distance = Math.hypot(world.x - cameraPosition.x, world.y - cameraPosition.y, world.z - cameraPosition.z);
        const projected = camera.camera.worldToScreen(point);
        const rect = canvas.getBoundingClientRect();
        const visible = projected.z > 0 && distance < NAMEPLATE_MAX_DISTANCE
          && projected.x >= 0 && projected.x <= canvas.clientWidth
          && projected.y >= 0 && projected.y <= canvas.clientHeight;
        plate.hidden = !visible;
        if (visible) {
          plate.style.left = `${projected.x + rect.left}px`;
          plate.style.top = `${projected.y + rect.top}px`;
        }
        // Local chat bubble (S1-B2): same anchor as the nameplate, drawn just above it.
        const say = sample.bubble ?? null;
        if (say !== bubbleText) { bubbleText = say; bubble.textContent = say ?? ""; }
        bubble.hidden = !visible || !say;
        if (!bubble.hidden) {
          bubble.style.left = `${projected.x + rect.left}px`;
          bubble.style.top = `${projected.y + rect.top - 26}px`;
        }
      },
      /** Slot names per projection state (no entities). */
      equipmentStatus: () => equipment.status(),
      destroy() {
        // Invalidate pending model loads and destroy equipment entities before the character goes.
        equipment.destroy();
        equipmentSource.dispose();
        plate.remove();
        bubble.remove();
        entity.destroy();
      }
    };
  };
}
