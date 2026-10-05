// Helicopter Flight Instrument HUD P0.7.
// Presentation-only: reads PlayerController flight authority and never mutates movement.
// NR / ENG are normalized assisted-flight values until rotor / engine simulation owns them.

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const heading = (value) => ((Math.round(finite(value)) % 360) + 360) % 360;
const signed = (value, digits = 0) => {
  const safe = finite(value);
  const sign = safe > 0 ? "+" : safe < 0 ? "−" : "";
  return `${sign}${Math.abs(safe).toFixed(digits)}`;
};

export const HELICOPTER_FLIGHT_HUD_STORAGE_KEY = "inhagame-helicopter-flight-hud-v1";

export const HELICOPTER_ASSISTED_POWER = Object.freeze({
  rotorRpmPct: 100,
  enginePct: 100
});

export function readHelicopterFlightHudEnabled(storage = null) {
  try {
    const value = storage?.getItem?.(HELICOPTER_FLIGHT_HUD_STORAGE_KEY);
    return value !== "off";
  } catch {
    return true;
  }
}

export function writeHelicopterFlightHudEnabled(enabled, storage = null) {
  try {
    storage?.setItem?.(HELICOPTER_FLIGHT_HUD_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage is only a preference cache. HUD control must still work without it.
  }
}

export function helicopterFlightState({ grounded = false, landing = false, speed = 0, verticalSpeed = 0 } = {}) {
  if (landing) return "LANDING";
  if (grounded && speed < 0.35) return "GROUND";
  if (verticalSpeed > 1.2) return "CLIMB";
  if (verticalSpeed < -1.2) return "DESCENT";
  if (speed > 8) return "CRUISE";
  return "HOVER";
}

export function helicopterFlightTelemetry({
  controller,
  position,
  groundHeight = 0
} = {}) {
  if (!controller?.onHelicopter) return null;
  const flight = controller.helicopterFlight ?? {};
  const vx = finite(flight.vx);
  const vy = finite(flight.vy);
  const vz = finite(flight.vz);
  const speed = Math.hypot(vx, vz);
  const altitude = Math.max(0, finite(position?.y) - finite(groundHeight));
  return {
    altitude,
    speed,
    verticalSpeed: vy,
    heading: heading(flight.yaw),
    yawRate: finite(flight.yawRate),
    pitch: finite(flight.pitch),
    roll: finite(flight.roll),
    rotorRpmPct: HELICOPTER_ASSISTED_POWER.rotorRpmPct,
    enginePct: HELICOPTER_ASSISTED_POWER.enginePct,
    mode: "ASSIST",
    state: helicopterFlightState({
      grounded: controller.grounded === true,
      landing: controller.landing === true,
      speed,
      verticalSpeed: vy
    })
  };
}

export function createHelicopterFlightHud({
  root,
  toggle,
  controller,
  getPosition,
  getGroundHeight,
  storage = typeof localStorage !== "undefined" ? localStorage : null
} = {}) {
  if (!root) return { update() {}, hide() {}, setEnabled() {}, get enabled() { return false; } };

  const nodes = Object.fromEntries([
    "alt", "vs", "pitch", "roll", "spd", "hdg", "yaw", "nr", "eng", "mode", "state", "attitude"
  ].map(key => [key, root.querySelector(`[data-flight-${key}]`) ]));
  const horizon = root.querySelector("[data-flight-horizon]");
  let enabled = readHelicopterFlightHudEnabled(storage);

  function syncToggle(visible) {
    if (!toggle) return;
    toggle.hidden = visible !== true;
    toggle.textContent = enabled ? "계기 OFF" : "계기 ON";
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", enabled ? "헬리콥터 계기판 끄기" : "헬리콥터 계기판 켜기");
  }

  function hide() {
    root.hidden = true;
    syncToggle(false);
  }

  function setEnabled(next, { persist = true } = {}) {
    enabled = next === true;
    if (persist) writeHelicopterFlightHudEnabled(enabled, storage);
    if (!enabled) root.hidden = true;
    syncToggle(controller?.onHelicopter === true);
    return enabled;
  }

  function update({ suppressed = false } = {}) {
    if (suppressed || !controller?.onHelicopter) {
      hide();
      return null;
    }

    syncToggle(true);
    if (!enabled) {
      root.hidden = true;
      return null;
    }

    const position = getPosition?.() ?? controller.entity?.getLocalPosition?.() ?? { x: 0, y: 0, z: 0 };
    const ground = getGroundHeight?.(position.x, position.z) ?? controller.groundY ?? 0;
    const data = helicopterFlightTelemetry({ controller, position, groundHeight: ground });
    if (!data) {
      hide();
      return null;
    }

    root.hidden = false;
    if (nodes.alt) nodes.alt.textContent = `${data.altitude.toFixed(1)} m`;
    if (nodes.vs) nodes.vs.textContent = `${signed(data.verticalSpeed, 1)} m/s`;
    if (nodes.pitch) nodes.pitch.textContent = `${signed(data.pitch, 0)}°`;
    if (nodes.roll) nodes.roll.textContent = `${signed(data.roll, 0)}°`;
    if (nodes.spd) nodes.spd.textContent = data.speed.toFixed(1);
    if (nodes.hdg) nodes.hdg.textContent = `${String(data.heading).padStart(3, "0")}°`;
    if (nodes.yaw) nodes.yaw.textContent = `${signed(data.yawRate, 0)}°/s`;
    if (nodes.nr) nodes.nr.textContent = `${data.rotorRpmPct}%`;
    if (nodes.eng) nodes.eng.textContent = `${data.enginePct}%`;
    if (nodes.mode) nodes.mode.textContent = data.mode;
    if (nodes.state) nodes.state.textContent = data.state;
    if (nodes.attitude) nodes.attitude.textContent = `P ${signed(data.pitch, 0)}° · R ${signed(data.roll, 0)}°`;

    if (horizon) {
      horizon.style.setProperty("--flight-horizon-roll", `${-data.roll}deg`);
      horizon.style.setProperty("--flight-horizon-pitch", `${clamp(data.pitch, -18, 18) * 1.15}px`);
    }
    return data;
  }

  toggle?.addEventListener("click", () => {
    setEnabled(!enabled);
    update();
  });

  root.hidden = true;
  syncToggle(false);
  return { update, hide, setEnabled, get enabled() { return enabled; } };
}
