export const CAMPAIGN_STAGES = [
  { id: 1, icon: '🌊', name: '인경호', role: '기본 전투 · 카드 · 첫/두 번째 진화', playable: true },
  { id: 2, icon: '🏛️', name: '본관', role: '장갑 · 밀집 전선 · 폭탄 시너지', playable: true },
  { id: 3, icon: '📚', name: '정석학술정보관', role: '방패 · 통로 · 관통 시너지', playable: true },
  { id: 4, icon: '🏫', name: '5호관', role: '분열 · 다중 전선 · 복제 시너지', playable: true },
  { id: 5, icon: '🎓', name: '60주년기념관', role: '엘리트 · 복합 기믹 · 빌드 완성', playable: true },
  { id: 6, icon: '🌙', name: '후문', role: '복합 전선 · 졸업논문 · FINAL', playable: true },
] as const;

export type StageStatus = 'LOCKED' | 'NEXT' | 'PLAY' | 'CLEAR';
export type StarGoal = 'clear' | 'hp50' | 'fusion';
export interface StageBest {
  remainingHp: number;
  durationMs: number;
  level: number;
  maxCombo: number;
  fusionCount: number;
  finishedAt: string;
  equipmentId?: string | null;
}
export interface StageProgress { goals: StarGoal[]; best: StageBest | null }
export interface CampaignProgress {
  version: 2;
  clearedStages: number[];
  highestUnlockedStage: number;
  rankingUnlocked: boolean;
  stages: Record<string, StageProgress>;
  updatedAt: string | null;
}
export interface StageClearResult extends Omit<StageBest, 'finishedAt'> { finishedAt?: string }

const KEY = 'induckupCampaignV2';
const LEGACY_KEY = 'induckupCampaignV1';
const MAX_STAGE = CAMPAIGN_STAGES.length;
const GOALS: StarGoal[] = ['clear', 'hp50', 'fusion'];

function validStage(value: unknown): number | null {
  const stage = Number(value);
  return Number.isInteger(stage) && stage >= 1 && stage <= MAX_STAGE ? stage : null;
}
function nonnegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}
function normalizeBest(value: unknown): StageBest | null {
  if (!value || typeof value !== 'object') return null;
  const best = value as Partial<StageBest>;
  if (typeof best.finishedAt !== 'string') return null;
  return {
    remainingHp: nonnegative(best.remainingHp), durationMs: nonnegative(best.durationMs),
    level: Math.max(1, nonnegative(best.level)), maxCombo: nonnegative(best.maxCombo),
    fusionCount: nonnegative(best.fusionCount), finishedAt: best.finishedAt,
    ...(typeof best.equipmentId === 'string' || best.equipmentId === null
      ? { equipmentId: best.equipmentId } : {}),
  };
}
export function emptyCampaignProgress(): CampaignProgress {
  return { version: 2, clearedStages: [], highestUnlockedStage: 1,
    rankingUnlocked: false, stages: {}, updatedAt: null };
}
export function normalizeCampaignProgress(value: unknown): CampaignProgress {
  if (!value || typeof value !== 'object') return emptyCampaignProgress();
  const src = value as Partial<CampaignProgress>;
  const cleared = Array.isArray(src.clearedStages)
    ? [...new Set(src.clearedStages.map(validStage).filter((n): n is number => n !== null))].sort((a, b) => a - b)
    : [];
  const rawStages = src.stages && typeof src.stages === 'object' ? src.stages : {};
  const stages: CampaignProgress['stages'] = {};
  for (const stage of CAMPAIGN_STAGES) {
    const record = (rawStages as Record<string, StageProgress>)[String(stage.id)];
    const goals = Array.isArray(record?.goals) ? GOALS.filter(goal => record.goals.includes(goal)) : [];
    if (cleared.includes(stage.id) && !goals.includes('clear')) goals.unshift('clear');
    const best = normalizeBest(record?.best);
    if (goals.length || best) stages[stage.id] = { goals, best };
  }
  const highestFromClears = cleared.length ? Math.min(MAX_STAGE, Math.max(...cleared) + 1) : 1;
  const requestedHighest = Number(src.highestUnlockedStage);
  const highest = Number.isFinite(requestedHighest)
    ? Math.min(MAX_STAGE, Math.max(1, Math.trunc(requestedHighest), highestFromClears))
    : highestFromClears;
  return { version: 2, clearedStages: cleared, highestUnlockedStage: highest,
    rankingUnlocked: cleared.includes(MAX_STAGE), stages,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : null };
}
function betterBest(a: StageBest | null, b: StageBest | null): StageBest | null {
  if (!a) return b;
  if (!b) return a;
  return b.remainingHp > a.remainingHp
    || (b.remainingHp === a.remainingHp && b.durationMs < a.durationMs) ? b : a;
}
export function mergeCampaignProgress(aValue: unknown, bValue: unknown): CampaignProgress {
  const a = normalizeCampaignProgress(aValue), b = normalizeCampaignProgress(bValue);
  const clearedStages = [...new Set([...a.clearedStages, ...b.clearedStages])].sort((x, y) => x - y);
  const stages: CampaignProgress['stages'] = {};
  for (const stage of CAMPAIGN_STAGES) {
    const x = a.stages[stage.id], y = b.stages[stage.id];
    const goals = GOALS.filter(goal => x?.goals.includes(goal) || y?.goals.includes(goal)
      || (goal === 'clear' && clearedStages.includes(stage.id)));
    const best = betterBest(x?.best ?? null, y?.best ?? null);
    if (goals.length || best) stages[stage.id] = { goals, best };
  }
  return normalizeCampaignProgress({
    clearedStages, stages, highestUnlockedStage: Math.max(a.highestUnlockedStage, b.highestUnlockedStage),
    updatedAt: [a.updatedAt, b.updatedAt].filter((s): s is string => !!s).sort().at(-1) ?? null,
  });
}
export function getStageStatus(progressValue: unknown, stageId: number): StageStatus {
  const stage = CAMPAIGN_STAGES.find(item => item.id === stageId);
  if (!stage) return 'LOCKED';
  const progress = normalizeCampaignProgress(progressValue);
  if (progress.clearedStages.includes(stageId)) return 'CLEAR';
  if (stageId > progress.highestUnlockedStage) return 'LOCKED';
  return stage.playable ? 'PLAY' : 'NEXT';
}
export function recordStageClear(currentValue: unknown, stageId: number, result?: StageClearResult): CampaignProgress {
  if (validStage(stageId) === null) return normalizeCampaignProgress(currentValue);
  const current = normalizeCampaignProgress(currentValue);
  const best: StageBest | null = result ? {
    remainingHp: nonnegative(result.remainingHp), durationMs: nonnegative(result.durationMs),
    level: Math.max(1, nonnegative(result.level)), maxCombo: nonnegative(result.maxCombo),
    fusionCount: nonnegative(result.fusionCount),
    finishedAt: result.finishedAt ?? new Date().toISOString(),
    ...(result.equipmentId === undefined ? {} : { equipmentId: result.equipmentId }),
  } : null;
  const old = current.stages[stageId];
  const achieved: StarGoal[] = ['clear'];
  if (best && best.remainingHp >= 50) achieved.push('hp50');
  if (best && best.fusionCount >= 1) achieved.push('fusion');
  return normalizeCampaignProgress({
    ...current, clearedStages: [...current.clearedStages, stageId],
    highestUnlockedStage: Math.min(MAX_STAGE, Math.max(current.highestUnlockedStage, stageId + 1)),
    stages: { ...current.stages, [stageId]: {
      goals: GOALS.filter(goal => old?.goals.includes(goal) || achieved.includes(goal)),
      best: betterBest(old?.best ?? null, best),
    } },
    updatedAt: best?.finishedAt ?? new Date().toISOString(),
  });
}
export function loadCampaignProgress(): CampaignProgress {
  const read = (key: string): unknown => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
  };
  return mergeCampaignProgress(read(KEY), read(LEGACY_KEY));
}
export function saveCampaignProgress(progress: CampaignProgress): void {
  try { localStorage.setItem(KEY, JSON.stringify(normalizeCampaignProgress(progress))); } catch {}
}
export function clearLocalCampaignProgress(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY_KEY); } catch {}
}
export function markCampaignStageClear(stage: number): CampaignProgress {
  const next = recordStageClear(loadCampaignProgress(), stage);
  saveCampaignProgress(next);
  return next;
}
