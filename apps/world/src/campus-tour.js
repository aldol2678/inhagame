import { TOUR_STOPS } from "./campus-layout.js";
import { placeIdForTour } from './legacy-zone-compat.js';

const STORAGE_KEY = "inhagame-campus-tour-v1";
const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

export function createCampusTour() {
  const progress = document.getElementById("tour-progress");
  const objective = document.getElementById("tour-objective");
  const bearing = document.getElementById("tour-bearing");
  const restart = document.getElementById("tour-restart");
  let stage = 0;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    // The former three-stop tour now ends at Main Hall; preserve completed progress.
    if (Number.isInteger(stored) && stored >= 0 && stored <= 3) stage = Math.min(stored, TOUR_STOPS.length);
  } catch { /* Tour still works when storage is unavailable. */ }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, String(stage)); } catch { /* Session-only progress. */ }
  }

  function render(position, yaw) {
    progress.textContent = `${stage} / ${TOUR_STOPS.length}`;
    restart.hidden = stage !== TOUR_STOPS.length;
    if (stage === TOUR_STOPS.length) {
      objective.textContent = "첫 탐방 완료! 🦆";
      bearing.textContent = "";
      return;
    }
    const stop = TOUR_STOPS[stage];
    const dx = stop.x - position.x;
    const dz = stop.z - position.z;
    const distance = Math.hypot(dx, dz);
    const right = dx * Math.cos(yaw) + dz * Math.sin(yaw);
    const forward = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const octant = Math.round(Math.atan2(right, forward) / (Math.PI / 4));
    const arrow = ARROWS[(octant + 8) % 8];
    objective.textContent = stop.label;
    bearing.textContent = `${arrow} ${Math.round(distance * 2)}m`;
  }

  restart.addEventListener("click", () => {
    stage = 0;
    save();
  });

  return {
    get stage() { return stage; },
    get target() {
      const stop = TOUR_STOPS[stage];
      return stop ? Object.freeze({ ...stop }) : null;
    },
    update(position, zoneId, yaw) {
      const stop = TOUR_STOPS[stage];
      if (stop && placeIdForTour(zoneId) === stop.placeZoneId && Math.hypot(position.x - stop.x, position.z - stop.z) <= stop.radius) {
        stage++;
        save();
      }
      render(position, yaw);
    }
  };
}
