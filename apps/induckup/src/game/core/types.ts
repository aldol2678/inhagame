import type { Body, Constraint, Engine } from 'matter-js';
import type { DuckKind, FlockLayout } from '../paddle/duckTypes';

export type RunPhase = 'READY' | 'RUNNING' | 'PAUSED' | 'CHOOSING' | 'UPGRADING' | 'CLEAR' | 'LOST';
export type PilotMode = 'living' | 'rigid';

export interface Vec2 {
  x: number;
  y: number;
}

export interface TelemetrySnapshot {
  mode: PilotMode;
  elapsedMs: number;
  paddleHits: number;
  brickHits: number;
  bricksDestroyed: number;
  maxFlexPx: number;
  maxBallSpeed: number;
  restartCount: number;
  hitsByDuckKind: Record<DuckKind, number>;
  bombBonusBricks: number;
  cloneTriggers: number;
  maxActiveBalls: number;
}

export interface PaddleRuntime {
  mode: PilotMode;
  bodies: Body[];
  constraints: Constraint[];
  update(targetX: number, deltaMs: number): void;
  stabilize?(): void;
  onBallHit(ball: Body, duckOrPaddle: Body): void;
  getFlexPx(): number;
  getCenterX(): number;
  destroy(engine: Engine): void;
}

export interface DebugSnapshot {
  mode: PilotMode;
  phase: RunPhase;
  ducks: number;
  bricksRemaining: number;
  telemetry: TelemetrySnapshot;
  duckPositions?: { x: number; y: number; angle: number; parts: number }[];
  ballPosition?: Vec2;
  ballPositions?: Vec2[];
  ballVelocities?: Vec2[];
  brickPositions?: Vec2[];
  reinforcedBricks?: { x: number; y: number; hp: number }[];
  worldBodies: number;
  worldConstraints: number;
  flockLayout?: FlockLayout;
  duckKinds?: readonly DuckKind[];
  fusionTiers?: readonly number[];
  mergeActive?: boolean;
  bombArmed?: boolean;
  ballEffect?: 'bomb' | 'elastic' | 'none';
  blastActive?: boolean;
  activeBalls?: number;
  cloneRemainingMs?: number;
  elasticMode?: 'standard' | 'strong';
  brickPattern?: 'classic' | 'clusters';
  cloneEnabled?: boolean;
  growthEnabled?: boolean;
  wave?: number;
  xp?: number;
  xpTarget?: number;
  level?: number;
  evolutions?: number;
  xpPopups?: string[];
  featherPositions?: Vec2[];
  evolutionPending?: boolean;
  evolvedKind?: DuckKind;
}
