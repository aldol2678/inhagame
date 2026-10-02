import { worldToMeters } from '../src/world-scale.js';

const ARROWS = Object.freeze(['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']);

export function questGuidance(target, position, yaw = 0) {
  if (!target || !position ||
      !Number.isFinite(target.x) || !Number.isFinite(target.z) ||
      !Number.isFinite(position.x) || !Number.isFinite(position.z) ||
      !Number.isFinite(yaw)) return null;

  const dx = target.x - position.x;
  const dz = target.z - position.z;
  const distanceWorld = Math.hypot(dx, dz);
  const right = dx * Math.cos(yaw) + dz * Math.sin(yaw);
  const forward = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const octant = Math.round(Math.atan2(right, forward) / (Math.PI / 4));
  const arrow = ARROWS[(octant + 8) % 8];

  return Object.freeze({
    arrow,
    distanceMeters: Math.max(0, Math.round(worldToMeters(distanceWorld)))
  });
}

export function formatQuestGuidance(target, position, yaw = 0, { interactionHint = false } = {}) {
  const guidance = questGuidance(target, position, yaw);
  if (!guidance) return '';
  const base = `${guidance.arrow} ${guidance.distanceMeters}m`;
  if (!interactionHint || target?.kind !== 'quest-npc' || guidance.distanceMeters > 3) return base;
  return `${base} · 상호작용으로 대화`;
}
