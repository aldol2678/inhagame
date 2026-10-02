import type { DuckKind } from '../game/paddle/duckTypes';
import {
  emptyCampaignProgress, mergeCampaignProgress, normalizeCampaignProgress, recordStageClear,
  type CampaignProgress, type StageClearResult,
} from '../home/progress';
import { emptyMeta, mergeMeta, normalizeMeta, type MetaProgress } from '../home/equipment';

export interface InduckUpProgress {
  version: 1;
  runsRecorded: number;
  clears: number;
  losses: number;
  bestWave: number;
  bestLevel: number;
  maxEvolutions: number;
  lastEvolutionKind: Exclude<DuckKind, 'basic'> | null;
  updatedAt: string | null;
  campaign: CampaignProgress;
  meta: MetaProgress;
}

export interface InduckUpRunResult {
  result: 'CLEAR' | 'LOST';
  wave: number;
  level: number;
  evolutions: number;
  evolvedKind: Exclude<DuckKind, 'basic'> | null;
  finishedAt?: string;
  campaign?: StageClearResult & { stageId: number };
}

export function emptyInduckUpProgress(): InduckUpProgress {
  return {
    version: 1,
    runsRecorded: 0,
    clears: 0,
    losses: 0,
    bestWave: 1,
    bestLevel: 1,
    maxEvolutions: 0,
    lastEvolutionKind: null,
    updatedAt: null,
    campaign: emptyCampaignProgress(),
    meta: emptyMeta(),
  };
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function evolution(value: unknown): Exclude<DuckKind, 'basic'> | null {
  return value === 'elastic' || value === 'pierce' || value === 'bomb' || value === 'clone' ? value : null;
}

export function normalizeInduckUpProgress(value: unknown): InduckUpProgress {
  const base = emptyInduckUpProgress();
  if (!value || typeof value !== 'object') return base;
  const src = value as Partial<InduckUpProgress>;
  return {
    version: 1,
    runsRecorded: int(src.runsRecorded),
    clears: int(src.clears),
    losses: int(src.losses),
    bestWave: Math.max(1, Math.min(2, int(src.bestWave, 1))),
    bestLevel: Math.max(1, Math.min(3, int(src.bestLevel, 1))),
    maxEvolutions: Math.max(0, Math.min(2, int(src.maxEvolutions))),
    lastEvolutionKind: evolution(src.lastEvolutionKind),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : null,
    // Historical cloud summaries only had a total CLEAR count. The old home UI
    // interpreted any such clear as Stage 1, so preserve that migration behavior.
    campaign: src.campaign ? normalizeCampaignProgress(src.campaign)
      : src.clears && int(src.clears) > 0
        ? recordStageClear(emptyCampaignProgress(), 1)
        : emptyCampaignProgress(),
    meta: normalizeMeta(src.meta),
  };
}

export function mergeInduckUpProgress(aValue: unknown, bValue: unknown): InduckUpProgress {
  const a = normalizeInduckUpProgress(aValue);
  const b = normalizeInduckUpProgress(bValue);
  const latest = [a, b].sort((x, y) => String(y.updatedAt ?? '').localeCompare(String(x.updatedAt ?? '')))[0];
  return {
    version: 1,
    runsRecorded: Math.max(a.runsRecorded, b.runsRecorded),
    clears: Math.max(a.clears, b.clears),
    losses: Math.max(a.losses, b.losses),
    bestWave: Math.max(a.bestWave, b.bestWave),
    bestLevel: Math.max(a.bestLevel, b.bestLevel),
    maxEvolutions: Math.max(a.maxEvolutions, b.maxEvolutions),
    lastEvolutionKind: latest.lastEvolutionKind ?? a.lastEvolutionKind ?? b.lastEvolutionKind,
    updatedAt: latest.updatedAt ?? a.updatedAt ?? b.updatedAt,
    campaign: mergeCampaignProgress(a.campaign, b.campaign),
    meta: mergeMeta(a.meta, b.meta),
  };
}

export function recordInduckUpRun(
  currentValue: unknown,
  result: InduckUpRunResult,
): InduckUpProgress {
  const current = normalizeInduckUpProgress(currentValue);
  return {
    version: 1,
    runsRecorded: current.runsRecorded + 1,
    clears: current.clears + Number(result.result === 'CLEAR'),
    losses: current.losses + Number(result.result === 'LOST'),
    bestWave: Math.max(current.bestWave, Math.max(1, Math.min(2, int(result.wave, 1)))),
    bestLevel: Math.max(current.bestLevel, Math.max(1, Math.min(3, int(result.level, 1)))),
    maxEvolutions: Math.max(current.maxEvolutions, Math.max(0, Math.min(2, int(result.evolutions)))),
    lastEvolutionKind: result.evolvedKind ?? current.lastEvolutionKind,
    updatedAt: result.finishedAt ?? new Date().toISOString(),
    campaign: result.result === 'CLEAR' && result.campaign
      ? recordStageClear(current.campaign, result.campaign.stageId, {
        ...result.campaign, finishedAt: result.finishedAt,
      })
      : current.campaign,
    meta: current.meta,
  };
}
