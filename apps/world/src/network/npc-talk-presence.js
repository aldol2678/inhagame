// Ephemeral presentation suppression, not an NPC lock or permission/reward authority.
export function sanitizeNpcTalk(raw) {
  if (!raw || typeof raw.npcId !== 'string' || !/^INKYUNG-NPC-0(?:0[1-9]|[1-3][0-9]|4[0-8])$/.test(raw.npcId) ||
      !Number.isSafeInteger(raw.until) || raw.until < 0) return null;
  return {npcId:raw.npcId,until:raw.until};
}
export function busyNpcIds(players,serverNow) {
  if(!Number.isFinite(serverNow))return [];
  return [...new Set(players.map(p=>sanitizeNpcTalk(p.npcTalk)).filter(p=>p&&p.until>serverNow&&p.until<=serverNow+15000).map(p=>p.npcId))];
}
