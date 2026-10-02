import type { PilotMode, TelemetrySnapshot } from '../core/types';
import type { DuckKind } from '../paddle/duckTypes';

export class PilotTelemetry {
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedDurationMs = 0;
  private paddleHits = 0;
  private brickHits = 0;
  private bricksDestroyed = 0;
  private maxFlexPx = 0;
  private maxBallSpeed = 0;
  private hitsByDuckKind: Record<DuckKind, number> = { basic: 0, elastic: 0, pierce: 0, bomb: 0, clone: 0 };
  private bombBonusBricks = 0;
  private cloneTriggers = 0;
  private maxActiveBalls = 1;

  constructor(private readonly mode: PilotMode, private restartCount = 0) {}

  start(nowMs: number): void {
    this.startedAt = nowMs;
  }

  pause(nowMs: number): void {
    if (this.pausedAt === null) this.pausedAt = nowMs;
  }

  resume(nowMs: number): void {
    if (this.pausedAt === null) return;
    this.pausedDurationMs += Math.max(0, nowMs - this.pausedAt);
    this.pausedAt = null;
  }

  recordPaddleHit(kind?: DuckKind | null): void {
    this.paddleHits += 1;
    if (kind) this.hitsByDuckKind[kind] += 1;
  }

  recordBrickHit(destroyed: boolean): void {
    this.brickHits += 1;
    if (destroyed) this.bricksDestroyed += 1;
  }

  recordAdditionalBrickDestroyed(): void {
    this.bricksDestroyed += 1;
    this.bombBonusBricks += 1;
  }

  recordClone(activeBalls: number): void {
    this.cloneTriggers += 1;
    this.maxActiveBalls = Math.max(this.maxActiveBalls, activeBalls);
  }

  observeFlex(px: number): void {
    this.maxFlexPx = Math.max(this.maxFlexPx, px);
  }

  observeBallSpeed(speed: number): void {
    this.maxBallSpeed = Math.max(this.maxBallSpeed, speed);
  }

  snapshot(nowMs: number): TelemetrySnapshot {
    return {
      mode: this.mode,
      elapsedMs: this.startedAt > 0
        ? Math.max(0, Math.round((this.pausedAt ?? nowMs) - this.startedAt - this.pausedDurationMs)) : 0,
      paddleHits: this.paddleHits,
      brickHits: this.brickHits,
      bricksDestroyed: this.bricksDestroyed,
      maxFlexPx: Math.round(this.maxFlexPx * 10) / 10,
      maxBallSpeed: Math.round(this.maxBallSpeed * 10) / 10,
      restartCount: this.restartCount,
      hitsByDuckKind: { ...this.hitsByDuckKind },
      bombBonusBricks: this.bombBonusBricks,
      cloneTriggers: this.cloneTriggers,
      maxActiveBalls: this.maxActiveBalls,
    };
  }
}
