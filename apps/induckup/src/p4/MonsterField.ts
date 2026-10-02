import { Bodies, Body, Composite, Engine } from 'matter-js';
import { LOGICAL_WIDTH } from '../game/config/tuning';
import { FIFTH_DIVIDER, FIFTH_FINAL_WAVE, FIFTH_FLANK_SHIFT, FIFTH_FRAGMENT_CAP, FIFTH_OPENING,
  FIFTH_STATS, FIFTH_SURGE_SPEED, FIFTH_TEAM_PARTS, FIFTH_WAVE_COLUMNS,
  type FifthMonsterKind } from './Stage4Battle';
import { ANNIVERSARY_COMMAND_DEFENSE, ANNIVERSARY_COMMAND_RADIUS, ANNIVERSARY_EXHIBITS,
  ANNIVERSARY_FREEZE_ELITE_MS, ANNIVERSARY_FREEZE_NORMAL_MS, ANNIVERSARY_FREEZE_SLOW,
  ANNIVERSARY_FINALS, ANNIVERSARY_LECTERN, ANNIVERSARY_STATS,
  ANNIVERSARY_WAVES } from './Stage5Battle';
import { BACK_GATE_LAMPS, BACK_GATE_TARGETS, BACK_GATE_WAVES, FINAL_BOSS_STATS,
  FINAL_PHASE_SPEED, FINAL_SHIELD_STATS, finalPhaseForHp, type BackGateArea } from './Stage6Battle';
import { rankedWavePlan, type RankedWavePlan } from './RankedWaves';

export type LakeMonsterKind = 'wave' | 'rapid' | 'armor' | 'swarm' | 'rush' | 'guard' | 'boss'
  | 'shield' | 'shelf' | 'support' | 'thesis'
  | 'splitter' | 'fragment' | 'flank' | 'surge' | 'team-doc' | 'team-contact' | 'team-slide'
  | 'elite-command' | 'elite-giant' | 'final-thesis' | 'final-shield';
export const BOOKSHELF_CATEGORY = 0x0002;
const TEAM_PARTS: readonly LakeMonsterKind[] = FIFTH_TEAM_PARTS;

export interface LakeMonsterView {
  body: Body;
  kind: LakeMonsterKind;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  warning: boolean;
  frozen: boolean;
  commandAura: boolean;
  finalPhase?: number;
  weakSpotX?: number;
}

export interface MonsterHitResult {
  body: Body;
  damage: number;
  destroyed: boolean;
  reward: boolean;
}

interface MonsterState {
  body: Body;
  kind: LakeMonsterKind;
  baseX: number;
  ageMs: number;
  phase: number;
  speed: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  counted: boolean;
  freezeRemainingMs: number;
}

const COLUMNS = [38, 95, 152, 208, 265, 322];
const DANGER_LINE_Y = 500;
const SPAWN_Y = 104;

const PATTERNS: number[][] = [
  [0, 3, 5],
  [2, 3, 4],
  [0, 1, 4],
  [1, 3, 5],
];

function statsFor(kind: LakeMonsterKind) {
  if (kind === 'armor') return { maxHp: 18, attack: 32, defense: 3, speed: 12 };
  if (kind === 'swarm') return { maxHp: 8, attack: 23, defense: 0, speed: 21 };
  if (kind === 'rush') return { maxHp: 14, attack: 38, defense: 2, speed: 32 };
  if (kind === 'guard') return { maxHp: 18, attack: 25, defense: 3, speed: 12 };
  if (kind === 'boss') return { maxHp: 90, attack: 45, defense: 12, speed: 11 };
  if (kind === 'shield') return { maxHp: 16, attack: 33, defense: 9, speed: 14 };
  if (kind === 'shelf') return { maxHp: 14, attack: 28, defense: 2, speed: 16 };
  if (kind === 'support') return { maxHp: 9, attack: 24, defense: 0, speed: 12 };
  if (kind === 'thesis') return { maxHp: 84, attack: 46, defense: 12, speed: 10 };
  if (kind in FIFTH_STATS) return FIFTH_STATS[kind as FifthMonsterKind];
  if (kind === 'elite-command' || kind === 'elite-giant') return ANNIVERSARY_STATS[kind];
  if (kind === 'final-thesis') return FINAL_BOSS_STATS;
  if (kind === 'final-shield') return FINAL_SHIELD_STATS;
  return kind === 'rapid'
    ? { maxHp: 10, attack: 40, defense: 0, speed: 23 }
    : { maxHp: 10, attack: 30, defense: 0, speed: 15 };
}

export class MonsterField {
  readonly dangerLineY = DANGER_LINE_Y;
  readonly target: number;
  private readonly states = new Map<number, MonsterState>();
  private spawned = 0;
  private defeated = 0;
  private breached = 0;
  private spawnTimerMs = 0;
  private patternIndex = 0;
  private bossPartsDefeated = 0;
  private bossBreached_ = false;
  private eliteBreached_ = false;
  private finalBreached_ = false;
  private finalPhase_: 1 | 2 | 3 | 4 | 5 = 1;
  private finalPhasePauseMs = 0;
  private finalMinionsSpawned = false;
  private readonly obstacles_: Body[] = [];
  private readonly previewPlan: RankedWavePlan | null;

  constructor(private readonly engine: Engine, readonly area: BackGateArea,
    private readonly testMode = false, readonly stageId: 1 | 2 | 3 | 4 | 5 | 6 = 1,
    readonly previewWave: number | null = null) {
    this.previewPlan = previewWave === null ? null : rankedWavePlan(previewWave);
    this.target = this.previewPlan?.enemies.length
      ?? (stageId === 6 ? BACK_GATE_TARGETS[area - 1] : area === 1 ? 18 : 24);
    if (this.previewPlan) {
      // Practice waves use the empty arena.
    } else if (stageId === 2) {
      this.obstacles_.push(...[108, 252].map(x => Bodies.rectangle(x, 244, 22, 80, {
        isStatic: true, label: 'stage-pillar', restitution: 1, friction: 0,
      })));
    } else if (stageId === 3) {
      this.obstacles_.push(...[
        { x: 86, y: 224, h: 92 }, { x: 274, y: 224, h: 92 }, { x: 180, y: 294, h: 76 },
      ].map(({ x, y, h }) => Bodies.rectangle(x, y, 26, h, {
        isStatic: true, label: 'stage-bookshelf', restitution: 1, friction: 0,
        collisionFilter: { category: BOOKSHELF_CATEGORY },
      })));
    } else if (stageId === 4 && area === 2) {
      this.obstacles_.push(Bodies.rectangle(FIFTH_DIVIDER.x, FIFTH_DIVIDER.y,
        FIFTH_DIVIDER.width, FIFTH_DIVIDER.height, {
        isStatic: true, label: 'stage-crossroad', restitution: 1, friction: 0,
      }));
    } else if (stageId === 5) {
      const exhibits = area === 1 ? ANNIVERSARY_EXHIBITS : [ANNIVERSARY_LECTERN];
      this.obstacles_.push(...exhibits.map(({ x, y, width, height }) => Bodies.rectangle(x, y,
        width, height, { isStatic: true, label: 'stage-anniversary', restitution: 1, friction: 0 })));
    } else if (stageId === 6 && area === 1) {
      this.obstacles_.push(...BACK_GATE_LAMPS.map(({ x, y, width, height }) => Bodies.rectangle(
        x, y, width, height,
        { isStatic: true, label: 'stage-backgate-lamp', restitution: 1, friction: 0 })));
    }
    Composite.add(this.engine.world, this.obstacles_);
    if (this.previewPlan) this.spawnWave(Math.min(3, this.target), true);
    else if (stageId === 6 && area === 4) {
      this.spawn(1, 'final-shield', 0, { x: 128, y: SPAWN_Y });
      this.spawn(4, 'final-shield', 0, { x: 232, y: SPAWN_Y });
      this.spawn(2, 'final-thesis', 0, { x: 180, y: SPAWN_Y });
    } else this.spawnWave(area === 1 ? 3 : 4, true);
    this.spawnTimerMs = this.intervalMs();
  }

  get views(): LakeMonsterView[] {
    return [...this.states.values()].map(state => ({
      body: state.body,
      kind: state.kind,
      hp: state.hp,
      maxHp: state.maxHp,
      attack: state.attack,
      defense: this.defenseFor(state),
      warning: (this.stageId === 5 || this.stageId === 6 || !!this.previewPlan) && this.isElite(state.kind)
        && state.body.position.y >= DANGER_LINE_Y - 80 || this.stageId === 4 && (state.kind === 'flank' && state.body.position.y >= 182
        && state.body.position.y < 250 || state.kind === 'surge' && state.body.position.y >= 235
        && state.body.position.y < 270 || TEAM_PARTS.includes(state.kind)
        && state.body.position.y >= DANGER_LINE_Y - 75)
        || state.kind === 'final-thesis' && (state.body.position.y >= DANGER_LINE_Y - 80
          || this.finalPhase_ === 5),
      frozen: state.freezeRemainingMs > 0,
      commandAura: state.kind === 'elite-command',
      finalPhase: state.kind === 'final-thesis' ? this.finalPhase_ : undefined,
      weakSpotX: state.kind === 'final-thesis' && this.finalPhase_ === 2
        ? this.weakSpotX(state) : undefined,
    }));
  }

  get activeCount(): number { return this.states.size; }
  get defeatedCount(): number { return this.defeated; }
  get breachedCount(): number { return this.breached; }
  get resolvedCount(): number { return this.defeated + this.breached; }
  get complete(): boolean { return this.spawned >= this.target && this.states.size === 0; }
  get bossBreached(): boolean { return this.bossBreached_; }
  get eliteBreached(): boolean { return this.eliteBreached_; }
  get finalBreached(): boolean { return this.finalBreached_; }
  get finalPhase(): number { return this.stageId === 6 && this.area === 4 ? this.finalPhase_ : 0; }
  get bossPartsCleared(): number { return this.bossPartsDefeated; }
  get obstacles(): readonly Body[] { return this.obstacles_; }

  update(deltaMs: number): number[] {
    const breachAttacks: number[] = [];
    this.finalPhasePauseMs = Math.max(0, this.finalPhasePauseMs - deltaMs);
    for (const state of [...this.states.values()]) {
      state.ageMs += deltaMs;
      const frozen = state.freezeRemainingMs > 0;
      state.freezeRemainingMs = Math.max(0, state.freezeRemainingMs - deltaMs);
      const amp = state.kind === 'rapid' || state.kind === 'rush' ? 8 : 0;
      const shift = this.stageId === 4 && state.kind === 'flank'
        ? (state.baseX < LOGICAL_WIDTH / 2 ? 1 : -1)
          * FIFTH_FLANK_SHIFT * Math.min(1, Math.max(0,
            (state.body.position.y - 205) / FIFTH_FLANK_SHIFT)) : 0;
      const x = Math.max(24, Math.min(LOGICAL_WIDTH - 24,
        state.baseX + shift + Math.sin(state.ageMs / 520 + state.phase) * amp));
      const speed = (this.stageId === 4 && state.kind === 'surge'
        && state.body.position.y >= 270 ? FIFTH_SURGE_SPEED : state.kind === 'final-thesis'
          ? this.finalPhasePauseMs > 0 ? 0 : FINAL_PHASE_SPEED[this.finalPhase_] : state.speed);
      const y = state.body.position.y + speed * (frozen ? ANNIVERSARY_FREEZE_SLOW : 1) * deltaMs / 1000;
      Body.setPosition(state.body, { x, y });
      if (y >= DANGER_LINE_Y) {
        if (this.previewPlan?.type === 'boss' && state.kind === 'boss') this.bossBreached_ = true;
        if (this.previewPlan?.type === 'elite' && state.kind === 'elite-giant') this.eliteBreached_ = true;
        if (this.stageId === 4 && TEAM_PARTS.includes(state.kind)) this.bossBreached_ = true;
        if (this.stageId === 5 && this.isElite(state.kind)) this.eliteBreached_ = true;
        if (this.stageId === 6 && (this.isElite(state.kind) || state.kind === 'final-thesis'))
          this.finalBreached_ = true;
        breachAttacks.push(state.attack);
        this.remove(state.body);
        if (state.counted) this.breached += 1;
      }
    }

    if (this.spawned < this.target && !(this.stageId === 6 && this.area === 4)) {
      this.spawnTimerMs -= deltaMs;
      if (this.spawnTimerMs <= 0) {
        const remaining = this.target - this.spawned;
        const count = Math.min(remaining, this.area === 1 ? (this.patternIndex % 2 ? 3 : 2) : 3);
        this.spawnWave(count);
        this.spawnTimerMs += this.intervalMs();
      }
    }
    return breachAttacks;
  }

  hit(body: Body, attack: number, defenseIgnore = 0,
    incoming?: { x: number; y: number }, impactX?: number): MonsterHitResult | null {
    const state = this.states.get(body.id);
    if (!state) return null;
    const effectiveDefense = Math.max(0, this.defenseFor(state, incoming, impactX) - Math.max(0, defenseIgnore));
    const damage = Math.max(1, Math.trunc(attack) - effectiveDefense);
    state.hp = Math.max(0, state.hp - damage);
    if (state.kind === 'final-thesis') this.advanceFinalPhase(state);
    const destroyed = state.hp <= 0;
    if (destroyed) {
      this.remove(body);
      if (state.counted) this.defeated += 1;
      if (TEAM_PARTS.includes(state.kind)) this.bossPartsDefeated += 1;
      if ((this.stageId === 4 || this.stageId === 5 || this.stageId === 6)
        && state.kind === 'splitter') this.split(state);
    }
    return { body, damage, destroyed, reward: state.counted };
  }

  hitNearest(origin: Body, count: number, attack: number, defenseIgnore = 0): MonsterHitResult[] {
    const candidates = [...this.states.values()]
      .filter(state => this.stageId === 1 || Math.hypot(
        state.body.position.x - origin.position.x, state.body.position.y - origin.position.y) <= 85)
      .sort((a, b) => {
        const da = Math.hypot(a.body.position.x - origin.position.x, a.body.position.y - origin.position.y);
        const db = Math.hypot(b.body.position.x - origin.position.x, b.body.position.y - origin.position.y);
        return da - db || a.body.id - b.body.id;
      });
    const results: MonsterHitResult[] = [];
    for (const state of candidates.slice(0, Math.max(0, count))) {
      const result = this.hit(state.body, attack, defenseIgnore);
      if (result) results.push(result);
    }
    return results;
  }

  freeze(body: Body): boolean {
    if (this.stageId !== 5) return false;
    const state = this.states.get(body.id);
    if (!state || state.kind === 'fragment') return false;
    state.freezeRemainingMs = this.isElite(state.kind)
      ? ANNIVERSARY_FREEZE_ELITE_MS : ANNIVERSARY_FREEZE_NORMAL_MS;
    return true;
  }

  forceCompleteForTest(): void {
    if (!this.testMode) return;
    for (const state of [...this.states.values()]) this.remove(state.body);
    this.spawned = this.target;
    if (this.stageId === 4 && this.area === 2) this.bossPartsDefeated = 3;
  }

  forceBreachForTest(kind?: LakeMonsterKind): void {
    if (!this.testMode) return;
    const first = kind ? [...this.states.values()].find(state => state.kind === kind)
      : this.states.values().next().value as MonsterState | undefined;
    if (first) Body.setPosition(first.body, { x: first.body.position.x, y: DANGER_LINE_Y + 1 });
  }

  destroy(): void {
    for (const state of [...this.states.values()]) this.remove(state.body);
    for (const obstacle of this.obstacles_) Composite.remove(this.engine.world, obstacle);
  }

  private defenseFor(state: MonsterState, incoming?: { x: number; y: number },
    impactX?: number): number {
    if (state.kind === 'final-thesis') {
      if (this.finalPhase_ === 2 && impactX !== undefined
        && Math.abs(impactX - this.weakSpotX(state)) <= 18) return 0;
      return state.defense + (this.finalPhase_ === 1
        && [...this.states.values()].some(other => other.kind === 'final-shield') ? 2 : 0);
    }
    if ((this.stageId === 3 || this.stageId === 5 || this.stageId === 6)
      && (state.kind === 'shield' || state.kind === 'thesis')) {
      // The enemies face the paddle. A ball arriving from above or the side exposes their weak edge.
      const frontal = !incoming || incoming.y < 0 && Math.abs(incoming.y) >= Math.abs(incoming.x) * 0.8;
      const support = state.kind === 'shield' && [...this.states.values()].some(other =>
        other.kind === 'support' && Math.abs(other.body.position.x - state.body.position.x) <= 75
        && Math.abs(other.body.position.y - state.body.position.y) <= 85);
      return (frontal ? state.defense : state.kind === 'thesis' ? 3 : 2) + Number(support) * 2
        + this.commandBonus(state);
    }
    if (this.stageId === 4 && state.kind === 'team-contact') {
      return state.defense + (this.states.size > 0 && [...this.states.values()]
        .some(other => other.kind === 'team-doc' || other.kind === 'team-slide') ? 3 : 0);
    }
    if (this.stageId === 5 || this.stageId === 6)
      return state.defense + this.commandBonus(state);
    if (this.previewPlan) return state.defense
      + (state.kind === 'boss' ? 5 * [...this.states.values()].filter(other => other.kind === 'guard').length : 0);
    return state.kind === 'boss' && this.states.size > 0
      ? 2 + 5 * [...this.states.values()].filter(other => other.kind === 'guard').length
      : state.defense;
  }

  private intervalMs(): number {
    if (this.testMode) return 700;
    if (this.previewPlan) return this.previewPlan.spawnIntervalMs;
    if (this.stageId === 6) return 5200;
    if (this.area === 1) return 8000;
    const progress = this.spawned / this.target;
    return progress >= 0.7 ? 5500 : 6500;
  }

  private spawnWave(count: number, initial = false): void {
    if (this.previewPlan) {
      const positions = PATTERNS[this.patternIndex++ % PATTERNS.length];
      for (let i = 0; i < count && this.spawned < this.target; i += 1) {
        const kind = this.previewPlan.enemies[this.spawned];
        this.spawn(positions[i % positions.length], kind, i);
      }
      return;
    }
    if (this.stageId === 6) {
      const remaining = this.target - this.spawned;
      const tough = () => [...this.states.values()].filter(s =>
        s.kind === 'armor' || s.kind === 'shield' || this.isElite(s.kind)).length;
      if (this.area === 2 && remaining <= 2) {
        if ([...this.states.values()].some(s => this.isElite(s.kind)) || tough() >= 2) return;
        this.spawn(this.spawned === this.target - 2 ? 2 : 3,
          this.spawned === this.target - 2 ? 'elite-command' : 'elite-giant', 0);
        return;
      }
      const area = this.area as 1 | 2 | 3;
      const patterns = BACK_GATE_WAVES[area];
      const pattern = patterns[this.patternIndex++ % patterns.length];
      const amount = Math.min(count, remaining - (this.area === 2 ? 2 : 0));
      for (let i = 0; i < amount; i += 1) {
        const proposed: LakeMonsterKind = pattern.kinds[i % pattern.kinds.length];
        const splitters = [...this.states.values()].filter(s => s.kind === 'splitter').length;
        const fragments = [...this.states.values()].filter(s => s.kind === 'fragment').length;
        const capped = (proposed === 'armor' || proposed === 'shield') && tough() >= 2
          || proposed === 'splitter' && (splitters >= 2
            || fragments + 2 * (splitters + 1) > FIFTH_FRAGMENT_CAP);
        this.spawn(pattern.columns[i % pattern.columns.length], capped ? 'wave' : proposed, i);
      }
      return;
    }
    if (this.stageId === 5) {
      const reserve = this.area === 1 ? 2 : 3;
      const remaining = this.target - this.spawned;
      const tough = () => [...this.states.values()].filter(s =>
        s.kind === 'armor' || s.kind === 'shield' || this.isElite(s.kind)).length;
      if (remaining === reserve) {
        if (tough() > (this.area === 1 ? 1 : 0)) return;
        const final = ANNIVERSARY_FINALS[this.area === 1 ? 1 : 2];
        final.forEach((enemy, i) => this.spawn(enemy.column, enemy.kind as LakeMonsterKind, i));
        return;
      }
      const amount = Math.min(count, remaining - reserve);
      const patterns = ANNIVERSARY_WAVES[this.area === 1 ? 1 : 2];
      const pattern = patterns[this.patternIndex++ % patterns.length];
      for (let i = 0; i < amount; i += 1) {
        const proposed = pattern.kinds[i % pattern.kinds.length] as LakeMonsterKind;
        const splitters = [...this.states.values()].filter(s => s.kind === 'splitter').length;
        const fragments = [...this.states.values()].filter(s => s.kind === 'fragment').length;
        const kind = (proposed === 'armor' || proposed === 'shield') && tough() >= 2
          || proposed === 'splitter' && (splitters >= 2
            || fragments + 2 * (splitters + 1) > FIFTH_FRAGMENT_CAP)
          ? 'wave' : proposed;
        this.spawn(pattern.columns[i % pattern.columns.length], kind, i);
      }
      return;
    }
    if (this.stageId === 4) {
      const remaining = this.target - this.spawned;
      if (this.area === 2 && remaining === 3) {
        FIFTH_FINAL_WAVE.forEach((part, i) => this.spawn(part.column, part.kind, i));
        return;
      }
      const number = this.area === 2 ? Math.min(count, remaining - 3) : count;
      const positions = FIFTH_WAVE_COLUMNS[this.patternIndex++ % FIFTH_WAVE_COLUMNS.length];
      for (let i = 0; i < number; i += 1) {
        const existingSplitters = [...this.states.values()].filter(s => s.kind === 'splitter').length;
        const existingFragments = [...this.states.values()].filter(s => s.kind === 'fragment').length;
        // Reserve two fragment slots for each living splitter, including this spawn.
        const canSplit = existingSplitters < 2
          && existingFragments + 2 * (existingSplitters + 1) <= FIFTH_FRAGMENT_CAP;
        const kind: LakeMonsterKind = initial && this.area === 1
          ? FIFTH_OPENING[i % FIFTH_OPENING.length]
          : this.spawned >= 9 && i === 1 ? 'surge'
            : i === 0 && canSplit && this.spawned >= 3 ? 'splitter' : 'flank';
        this.spawn(positions[i % positions.length], kind, i);
      }
      return;
    }
    if (this.stageId === 3) {
      const remaining = this.target - this.spawned;
      if (this.area === 2 && remaining <= 3) {
        this.spawn(1, 'shield', 0);
        this.spawn(4, 'shield', 0);
        this.spawn(2, 'thesis', 0);
        return;
      }
      const number = this.area === 2 ? Math.min(count, remaining - 3) : count;
      const pattern = this.patternIndex++ % 2;
      const columns = pattern ? [1, 3, 4, 2] : [0, 2, 4, 5];
      const first = this.spawned;
      for (let i = 0; i < number; i += 1) {
        const kind: LakeMonsterKind = initial && this.area === 1
          ? (['support', 'shelf', 'shield'] as const)[i % 3]
          : (['shield', 'shelf', 'support', 'shelf'] as const)[(first + i) % 4];
        this.spawn(columns[i % columns.length], kind, i);
      }
      return;
    }
    if (this.stageId === 2) {
      if (this.area === 2 && this.target - this.spawned <= 3) {
        const remaining = this.target - this.spawned;
        if (remaining >= 3) {
          this.spawn(1, 'guard', 0);
          this.spawn(4, 'guard', 0);
          this.spawn(2, 'boss', 0);
        }
        return;
      }
      const clusters = this.patternIndex++ % 3 === 1;
      const positions = clusters ? [1, 2, 3, 4] : [0, 2, 3, 5];
      const ordinaryCount = this.area === 2 ? Math.min(count, this.target - this.spawned - 3) : count;
      for (let i = 0; i < ordinaryCount && this.spawned < this.target; i += 1) {
        const kind: LakeMonsterKind = initial && i > 0 ? 'swarm' : clusters ? 'swarm'
          : i === 0 && this.patternIndex % 3 === 0 ? 'rush' : 'armor';
        this.spawn(positions[i % positions.length], kind, i);
      }
      return;
    }
    const pattern = PATTERNS[this.patternIndex++ % PATTERNS.length];
    const positions = initial && this.area === 1 ? [1, 3, 5] : pattern;
    for (let i = 0; i < count && this.spawned < this.target; i += 1) {
      const col = positions[i % positions.length];
      const kind: LakeMonsterKind = this.area === 2 && ((this.spawned + i) % 10 < 3
        || (!initial && this.patternIndex % 4 === 0 && i === 0))
        ? 'rapid' : 'wave';
      this.spawn(col, kind, i);
    }
  }

  private spawn(column: number, kind: LakeMonsterKind, localIndex: number,
    position?: { x: number; y: number }): void {
    const x = position?.x ?? COLUMNS[column] ?? LOGICAL_WIDTH / 2;
    const y = position?.y ?? SPAWN_Y - localIndex * 3 - (kind === 'support' ? 14 : 0);
    const stats = statsFor(kind);
    const multiplier = this.previewPlan?.multiplier ?? 1;
    const maxHp = Math.ceil(stats.maxHp * multiplier);
    const body = Bodies.circle(x, y, kind === 'boss' || kind === 'thesis'
      || kind === 'final-thesis'
      || kind === 'elite-giant' ? 24
      : TEAM_PARTS.includes(kind) ? 19
        : kind === 'rapid' || kind === 'rush' || kind === 'support' || kind === 'surge' ? 14
          : kind === 'fragment' ? 10 : 16, {
      isStatic: true,
      label: 'p4-monster',
      restitution: 1,
      friction: 0,
    });
    const state: MonsterState = {
      body,
      kind,
      baseX: x,
      ageMs: 0,
      phase: (this.spawned + 1) * 0.73,
      speed: stats.speed * (this.previewPlan ? Math.min(1.55, 1 + (multiplier - 1) * 0.25) : 1),
      hp: maxHp,
      maxHp,
      attack: Math.ceil(stats.attack * multiplier),
      defense: stats.defense + (this.previewPlan ? Math.floor(multiplier - 1) : 0),
      counted: kind !== 'fragment',
      freezeRemainingMs: 0,
    };
    if (state.counted) this.spawned += 1;
    this.states.set(body.id, state);
    Composite.add(this.engine.world, body);
  }

  private split(parent: MonsterState): void {
    for (const side of [-1, 1]) {
      this.spawn(0, 'fragment', 0, {
        x: Math.max(16, Math.min(LOGICAL_WIDTH - 16, parent.body.position.x + side * 20)),
        y: parent.body.position.y - 7,
      });
    }
  }

  private isElite(kind: LakeMonsterKind): boolean {
    return kind === 'elite-command' || kind === 'elite-giant';
  }

  private commandBonus(state: MonsterState): number {
    if (this.stageId !== 5 && this.stageId !== 6
      || state.kind === 'fragment' || this.isElite(state.kind)) return 0;
    return [...this.states.values()].some(other => other.kind === 'elite-command'
      && Math.hypot(other.body.position.x - state.body.position.x,
        other.body.position.y - state.body.position.y) <= ANNIVERSARY_COMMAND_RADIUS)
      ? ANNIVERSARY_COMMAND_DEFENSE : 0;
  }

  private remove(body: Body): void {
    if (!this.states.delete(body.id)) return;
    Composite.remove(this.engine.world, body);
  }

  private weakSpotX(state: MonsterState): number {
    return state.body.position.x + (Math.sin(state.ageMs / 780) >= 0 ? 17 : -17);
  }

  private advanceFinalPhase(boss: MonsterState): void {
    const next = finalPhaseForHp(boss.hp);
    if (next <= this.finalPhase_) return;
    this.finalPhase_ = next;
    this.finalPhasePauseMs = 1000;
    if (next >= 3 && !this.finalMinionsSpawned) {
      this.finalMinionsSpawned = true;
      this.spawn(0, 'shield', 0, { x: 58, y: SPAWN_Y });
      this.spawn(5, 'rush', 0, { x: 304, y: SPAWN_Y });
    }
  }
}
