// Presentation-only proximity. Never sent as evidence to Quest/Reward authority.
export const INCOME_SCENE_GIVER = 'INKYUNG-NPC-013';
export function createIncomeSceneInteraction({ enabled = false, location = globalThis.location,
  readScene, panel, onLabel = () => {} }) {
  const local = enabled && ['localhost', '127.0.0.1'].includes(location?.hostname);
  let disposed = false, owner = null, openedSpace = null, generation = 0;
  const finite = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
  function eligible(s) {
    if (!local || disposed || !s?.accountId || s.blocked || s.inside || s.mounted || s.seated ||
        s.mainQuestPending || s.conversationOpen || s.sceneId !== 'campus') return false;
    const npc = s.npc;
    return npc?.id === INCOME_SCENE_GIVER && npc.visible === true && finite(npc.position) && finite(s.position) &&
      Math.abs(npc.position.y - s.position.y) <= 1.5 &&
      Math.hypot(npc.position.x - s.position.x, npc.position.z - s.position.z) <= 2.5;
  }
  function close(restoreFocus = false) { openedSpace = null; return panel.close({ restoreFocus }); }
  function observe() {
    const s = readScene();
    if (owner !== (s?.accountId ?? null)) { owner = s?.accountId ?? null; generation++; close(); void panel.setAccount(owner); }
    // Open panels own the input lock; host must not include that lease in s.blocked.
    const available = eligible(s);
    if (panel.open && (!available || openedSpace !== s.sceneId)) close();
    onLabel({ visible: available && !panel.open, npcId: INCOME_SCENE_GIVER,
      text: '가태린 · 납품 후보 기록 (지급 닫힘)', position: available ? { ...s.npc.position } : null });
    if (!available || panel.open) return null;
    const epoch = generation;
    return { id: 'income-taerin-candidate', icon: '📦', label: '가태린 납품 후보 기록', compactLabel: '납품 기록',
      shortcut: 'F', priority: 305,
      distance: Math.hypot(s.npc.position.x - s.position.x, s.npc.position.z - s.position.z),
      trigger: ({ opener } = {}) => {
        const latest = readScene();
        if (epoch !== generation || latest?.accountId !== owner || !eligible(latest) || panel.open) return false;
        openedSpace = latest.sceneId; void panel.openPanel({ opener }); return true;
      } };
  }
  return { observe, close: () => close(true), dispose() { if (disposed) return; disposed = true; generation++; close(); onLabel({ visible: false, position: null }); panel.dispose(); } };
}
