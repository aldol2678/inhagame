import { Body, Bounds, Composite, Engine, Events } from 'matter-js';
import './p4.css';
import { BallSystem } from '../game/ball/BallSystem';
import { tuning } from '../game/config/tuning';
import { createRunState } from '../game/core/runState';
import type { RunPhase } from '../game/core/types';
import { InputController } from '../game/input/InputController';
import { adjacentFusionSource } from '../game/paddle/duckFusion';
import { LivingPaddle } from '../game/paddle/LivingPaddle';
import type { DuckKind } from '../game/paddle/duckTypes';
import { createWorld } from '../game/physics/createWorld';
import { GameRenderer } from '../game/render/GameRenderer';
import { LakeGrowth } from './LakeGrowth';
import { BOOKSHELF_CATEGORY, MonsterField, type LakeMonsterKind } from './MonsterField';
import { applyBreachDamage, createCombatStats, type CombatStats } from './CombatStats';
import { applyUpgradeCard, offerUpgradeCards, rerollUpgradeCard, type UpgradeCard, type UpgradeCardId } from './RogueCards';
import { ANNIVERSARY_FREEZE_COOLDOWN_MS } from './Stage5Battle';
import { FINAL_PHASE_NAMES, type BackGateArea } from './Stage6Battle';
import { InhaGameAccount } from '../account/InhaGameAccount';
import { EQUIPMENT, type EquipmentId, type CosmeticId } from '../home/equipment';
import { projectedLandingX } from './LandingChalk';

const hubEntry = (window as Window & { InhaGameEntry?: {
  landing(): void; play(): void; result(): boolean; clear(): void; retry(): void;
} }).InhaGameEntry;

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Missing #app root');
const root = appRoot;
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';
const rankedPreview = params.get('play') === 'ranking-preview';
const requestedStage = Number(params.get('stage'));
const stageId: 1 | 2 | 3 | 4 | 5 | 6 = params.get('play') === 'campaign'
  && (requestedStage === 2 || requestedStage === 3 || requestedStage === 4
    || requestedStage === 5 || requestedStage === 6) ? requestedStage : 1;
const stageName = stageId === 6 ? '후문' : stageId === 5 ? '60주년기념관' : stageId === 4 ? '5호관' : stageId === 3 ? '정석학술정보관'
  : stageId === 2 ? '본관' : '인경호';
document.title = rankedPreview ? '인덕업 · 무한 생존 연습' : `인덕업 · ${stageName}`;

root.innerHTML = `
<section class="pilot-shell p4-shell" data-growth="true">
  <header class="pilot-header">
    <div class="pilot-title-row">
      <h1>인덕업 🦆${stageId === 6 ? '🌙' : stageId === 5 ? '🎓' : stageId === 4 ? '🏫' : stageId === 3 ? '📚' : stageId === 2 ? '🏛️' : '🌊'}</h1>
      <div class="p4-header-actions">
        <a class="p4-home-button" href="./" aria-label="메인 허브로 이동">🏠 메인</a>
        <span class="pilot-badge">${rankedPreview ? 'PREVIEW · 기록 없음' : 'LIVE'}</span>
      </div>
    </div>
    <p>${rankedPreview ? '무한 생존 전투 연습입니다. 장비·영구성장 없이 시작하며 캠페인과 랭킹에 기록되지 않습니다.' : stageId === 6
      ? '후문 길목의 전선을 넘고 졸업논문을 막으세요. 야간 전투 지형은 게임용 각색입니다.'
      : stageId === 5
      ? '지휘의 방어 지원을 끊고 Elite를 막으세요. 로비와 강의구역 전투 배치는 각색입니다.'
      : stageId === 4
      ? '좌우 전선을 공략하세요. 복제로 두 전선을 함께 공격할 수 있습니다. 5호관 전투 동선은 각색입니다.'
      : stageId === 3
      ? '방패 정면은 단단합니다. 측후면을 노리거나 관통으로 책장·방패를 돌파하세요.'
      : 'HP를 지키며 성장 카드를 고르고, Lv.3·Lv.6에서 오리를 진화시키세요.'}</p>
  </header>
  <div class="game-card" data-game-surface>
    <canvas aria-label="인덕업 ${rankedPreview ? '무한 생존 연습' : stageName} 하강 몬스터 게임 화면"></canvas>
    <div class="hud">
      <div class="hud-main">
        <div><strong>${rankedPreview ? '무한 생존 · 연습' : `Stage ${stageId} · ${stageName}`}</strong></div>
        <strong class="growth-level" data-ui="growth-level"></strong>
        <div class="mode">${rankedPreview ? 'PREVIEW · NO RECORD' : 'CAMPAIGN'}</div>
      </div>
      <div class="hud-sub">
        <span class="p4-defence" data-ui="defence"></span>
        <span class="p4-progress" data-ui="progress"></span>
        <span data-ui="stats"></span>
        <span data-ui="equipment"></span>
        <button type="button" class="pause-button" data-ui="pause" aria-label="일시정지" hidden>Ⅱ</button>
      </div>
      <div class="growth-meter" data-ui="growth-meter" role="progressbar" aria-label="진화 경험치">
        <span data-ui="growth-fill"></span>
      </div>
      <div class="result-panel pause-panel" data-ui="pause-panel" hidden>
        <strong>일시정지</strong>
        <p>준비되면 이어서 플레이하세요.</p>
        <button type="button" data-ui="resume">계속하기</button>
      </div>
      <div class="result-panel evolution-panel" data-ui="evolution" hidden>
        <strong data-ui="evolution-title">첫 진화!</strong>
        <p>능력을 고르고 진화할 오리를 선택하세요.</p>
        <div class="evolution-kinds" aria-label="진화 능력">
          <button type="button" data-kind="pierce">관통</button>
          <button type="button" data-kind="bomb">폭탄</button>
          <button type="button" data-kind="clone">복제</button>
        </div>
        <div class="evolution-slots" aria-label="진화할 오리">
          <button type="button" data-slot="0">1</button><button type="button" data-slot="1">2</button>
          <button type="button" data-slot="2">3</button><button type="button" data-slot="3">4</button>
          <button type="button" data-slot="4">5</button>
        </div>
        <small data-ui="evolution-help">왼쪽부터 오리 1~5번</small>
      </div>
      <div class="result-panel upgrade-panel" data-ui="upgrade" hidden>
        <strong>LEVEL UP!</strong>
        <p data-ui="upgrade-level"></p>
        <div class="upgrade-cards" data-ui="upgrade-cards"></div>
        <small data-ui="reroll-help"></small>
      </div>
      <div class="result-panel" data-ui="result" hidden>
        <div class="result-copy" data-ui="result-copy"></div>
        <div class="result-actions">
          <button type="button" data-ui="restart">다시 꽥 <span class="restart-key">R</span></button>
          <a class="result-home" href="${rankedPreview ? '?ranking=1' : './'}">${rankedPreview ? '랭킹전 로비' : '메인으로'}</a>
        </div>
      </div>
    </div>
  </div>
  <footer class="pilot-footer">
    <span>드래그 · A/D · ←/→ · P 일시정지 · R 다시하기</span>
    <span><a class="p4-back-link" href="${rankedPreview ? '?ranking=1' : './'}">${rankedPreview ? '랭킹전 로비' : '메인'}</a></span>
  </footer>
  <p class="duck-key">Lv.2/4/5/7… 3택1 성장 · Lv.3/6 진화 · 기본 HP 100 · DEF 5 · 공 ATK 10</p>
</section>`;

const surface = root.querySelector<HTMLElement>('[data-game-surface]')!;
const canvas = surface.querySelector<HTMLCanvasElement>('canvas')!;
const defenceEl = root.querySelector<HTMLElement>('[data-ui="defence"]')!;
const progressEl = root.querySelector<HTMLElement>('[data-ui="progress"]')!;
const statsEl = root.querySelector<HTMLElement>('[data-ui="stats"]')!;
const equipmentEl = root.querySelector<HTMLElement>('[data-ui="equipment"]')!;
const growthLevelEl = root.querySelector<HTMLElement>('[data-ui="growth-level"]')!;
const growthMeterEl = root.querySelector<HTMLElement>('[data-ui="growth-meter"]')!;
const growthFillEl = root.querySelector<HTMLElement>('[data-ui="growth-fill"]')!;
const pauseButton = root.querySelector<HTMLButtonElement>('[data-ui="pause"]')!;
const pausePanel = root.querySelector<HTMLElement>('[data-ui="pause-panel"]')!;
const evolutionPanel = root.querySelector<HTMLElement>('[data-ui="evolution"]')!;
const upgradePanel = root.querySelector<HTMLElement>('[data-ui="upgrade"]')!;
const upgradeLevelEl = root.querySelector<HTMLElement>('[data-ui="upgrade-level"]')!;
const upgradeCardsEl = root.querySelector<HTMLElement>('[data-ui="upgrade-cards"]')!;
const rerollHelpEl = root.querySelector<HTMLElement>('[data-ui="reroll-help"]')!;
const resultPanel = root.querySelector<HTMLElement>('[data-ui="result"]')!;
const resultCopy = root.querySelector<HTMLElement>('[data-ui="result-copy"]')!;
const evolutionKinds: Exclude<DuckKind, 'basic'>[] = ['pierce', 'bomb', 'clone'];

interface BallEffect {
  bombArmed: boolean;
  bombPower: number;
  elasticMs: number;
  pierceRemaining: number;
  trail: { x: number; y: number }[];
  isClone: boolean;
  remainingMs: number;
}

interface P4Debug {
  phase: RunPhase;
  previewWave: number | null;
  completedWaves: number;
  previewKills: number;
  area: BackGateArea;
  defence: number;
  hp: number;
  maxHp: number;
  ballAttack: number;
  breachShield: number;
  upgradeLevel: number | null;
  upgradeOffer: string[];
  pickedCards: string[];
  monsterCount: number;
  resolved: number;
  target: number;
  defeated: number;
  breached: number;
  xp: number;
  xpTarget: number;
  totalXp: number;
  level: number;
  nextEvolutionLevel: number | null;
  evolutions: number;
  evolutionPending: boolean;
  ducks: number;
  duckKinds: readonly DuckKind[];
  fusionTiers: readonly number[];
  activeBalls: number;
  combo: number;
  maxCombo: number;
  antiStallRescues: number;
  bombBonusKills: number;
  cloneBonusKills: number;
  piercePasses: number;
  pierceRemaining: number;
  bossPartsCleared: number;
  bossBreached: boolean;
  eliteBreached: boolean;
  finalBreached: boolean;
  finalPhase: number;
  freezeEnabled: boolean;
  monsterPositions: { x: number; y: number; kind: LakeMonsterKind; hp: number; maxHp: number;
    attack: number; defense: number; frozen: boolean }[];
  ballPositions: { x: number; y: number }[];
  ballVelocities: { x: number; y: number }[];
  equipmentId: EquipmentId | null;
  cosmeticId: CosmeticId | null;
  recoveryRemaining: number;
  recoveredCount: number;
  chalkAvailable: boolean;
  landingX: number | null;
  notebookUsed: boolean;
}

class LakePreviewGame {
  private world = createWorld();
  private paddle!: LivingPaddle;
  private ball!: BallSystem;
  private monsters!: MonsterField;
  private growth = new LakeGrowth();
  private run = createRunState();
  private readonly input = new InputController(surface);
  private readonly renderer = new GameRenderer(canvas);
  private collisionHandler?: (event: Matter.IEventCollision<Engine>) => void;
  private readonly effects = new Map<number, BallEffect>();
  private pendingClone: { ball: Body; fused: boolean }[] = [];
  private area: BackGateArea = 1;
  private previewWave = 1;
  private completedWaves = 0;
  private previewKills = 0;
  private combat: CombatStats = createCombatStats();
  private areaCleared = false;
  private readonly awardedUpgradeLevels = new Set<number>();
  private upgradeLevel: number | null = null;
  private upgradeOffer: UpgradeCard[] = [];
  private pickedCards: UpgradeCardId[] = [];
  private freezeEnabled = false;
  private lastFreezeAt = -ANNIVERSARY_FREEZE_COOLDOWN_MS;
  private runSeed = 1;
  private selectedKind: Exclude<DuckKind, 'basic'> | null = null;
  private launchAt = 0;
  private lastFrame = performance.now();
  private raf = 0;
  private combo = 0;
  private maxCombo = 0;
  private bombBonusKills = 0;
  private cloneBonusKills = 0;
  private antiStallRescues = 0;
  private piercePasses = 0;
  private totalBreaches = 0;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private readonly lastMonsterHitAt = new Map<number, number>();
  private readonly topSince = new Map<number, number>();
  private readonly preCollisionVelocity = new Map<number, { x: number; y: number }>();
  private readonly pendingPierceVelocity = new Map<number, { x: number; y: number }>();
  private xpPopups: { x: number; y: number; label: string; ms: number }[] = [];
  private impact: { x: number; y: number; kind: 'elastic' | 'pierce' | 'bomb' | 'clone'; ms: number } | null = null;
  private blast: { x: number; y: number; neighbors: { x: number; y: number }[]; ms: number } | null = null;
  private mergeBurst: { x: number; y: number; kind: Exclude<DuckKind, 'basic'>; ms: number } | null = null;
  private effectTimeMs = 0;
  private readonly account = new InhaGameAccount();
  private runRecorded = false;
  private fusionCount = 0;
  private equipmentId: EquipmentId | null = null;
  private cosmeticId: CosmeticId | null = null;
  private chalkAvailable = false;
  private notebookUsed = false;

  constructor() {
    this.bindUi();
    void this.start();
  }

  private async start(): Promise<void> {
    await this.account.init();
    this.buildRun();
    this.loop(performance.now());
  }

  private bindUi(): void {
    pauseButton.addEventListener('click', () => this.togglePause());
    root.querySelector<HTMLButtonElement>('[data-ui="resume"]')!
      .addEventListener('click', () => this.togglePause());
    root.querySelector<HTMLButtonElement>('[data-ui="restart"]')!
      .addEventListener('click', () => this.restart());

    evolutionPanel.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => {
      button.addEventListener('click', () => this.selectKind(button.dataset.kind as Exclude<DuckKind, 'basic'>));
    });
    evolutionPanel.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
      button.addEventListener('click', () => {
        if (this.selectedKind && this.run.phase === 'CHOOSING') {
          this.chooseEvolution(this.selectedKind, Number(button.dataset.slot));
        }
      });
    });
    upgradeCardsEl.addEventListener('click', event => {
      const reroll = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-reroll-slot]');
      if (reroll) { this.rerollCard(Number(reroll.dataset.rerollSlot)); return; }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-upgrade-card]');
      if (button?.dataset.upgradeCard) this.chooseUpgrade(button.dataset.upgradeCard as UpgradeCardId);
    });
    window.addEventListener('keydown', this.onKeyDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.run.phase === 'UPGRADING') {
      const slot = /^(?:Digit|Numpad)([1-3])$/.exec(event.code)?.[1]
        ?? (/^[1-3]$/.test(event.key) ? event.key : null);
      if (slot) {
        event.preventDefault();
        const card = this.upgradeOffer[Number(slot) - 1];
        if (card) this.chooseUpgrade(card.id);
      }
      return;
    }
    if (this.run.phase === 'CHOOSING') {
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
      if (direction) {
        event.preventDefault();
        const current = this.selectedKind ? evolutionKinds.indexOf(this.selectedKind) : -1;
        const next = current < 0 ? direction < 0 ? evolutionKinds.length - 1 : 0
          : (current + direction + evolutionKinds.length) % evolutionKinds.length;
        this.selectKind(evolutionKinds[next]);
        return;
      }
      const slot = /^(?:Digit|Numpad)([1-5])$/.exec(event.code)?.[1]
        ?? (/^[1-5]$/.test(event.key) ? event.key : null);
      if (slot && this.selectedKind) {
        event.preventDefault();
        this.chooseEvolution(this.selectedKind, Number(slot) - 1);
      }
      return;
    }
    if ((event.code === 'KeyP' || event.key.toLowerCase() === 'p' || event.key === 'ㅔ')
      && (this.run.phase === 'RUNNING' || this.run.phase === 'PAUSED')) {
      event.preventDefault();
      this.togglePause();
      return;
    }
    if ((event.code === 'KeyR' || event.key.toLowerCase() === 'r' || event.key === 'ㄱ')
      && (this.run.phase === 'CLEAR' || this.run.phase === 'LOST')) {
      event.preventDefault();
      this.restart();
    }
  };

  private buildRun(): void {
    this.detachCollisions();
    Engine.clear(this.world.engine);
    Composite.clear(this.world.engine.world, false, true);
    this.world = createWorld();
    this.run = createRunState();
    this.area = 1;
    this.previewWave = 1;
    this.completedWaves = 0;
    this.previewKills = 0;
    this.combat = createCombatStats();
    this.areaCleared = false;
    this.awardedUpgradeLevels.clear();
    this.upgradeLevel = null;
    this.upgradeOffer = [];
    this.pickedCards = [];
    this.runSeed = Math.floor(Math.random() * 0x7fffffff) || 1;
    this.growth = new LakeGrowth();
    this.selectedKind = null;
    this.combo = 0;
    this.maxCombo = 0;
    this.bombBonusKills = 0;
    this.cloneBonusKills = 0;
    this.freezeEnabled = false;
    this.lastFreezeAt = -ANNIVERSARY_FREEZE_COOLDOWN_MS;
    this.antiStallRescues = 0;
    this.piercePasses = 0;
    this.totalBreaches = 0;
    this.startedAt = 0;
    this.pausedAt = null;
    this.pausedTotal = 0;
    this.lastMonsterHitAt.clear();
    this.topSince.clear();
    this.preCollisionVelocity.clear();
    this.pendingPierceVelocity.clear();
    this.effects.clear();
    this.pendingClone = [];
    this.xpPopups = [];
    this.impact = null;
    this.blast = null;
    this.mergeBurst = null;
    this.effectTimeMs = 0;
    this.runRecorded = false;
    this.fusionCount = 0;
    this.equipmentId = rankedPreview ? null : this.account.getActiveEquipment();
    this.cosmeticId = rankedPreview ? null : this.account.getActiveCosmetic();
    this.chalkAvailable = this.equipmentId === 'landing-chalk';
    this.notebookUsed = false;
    if (this.equipmentId === 'feather-recovery') this.growth.enableRecovery();
    this.input.reset();
    this.paddle = new LivingPaddle(this.world.engine, 180, 'off', false, 'standard');
    this.ball = new BallSystem(this.world.engine);
    this.effects.set(this.ball.body.id, this.newEffect(false));
    this.monsters = new MonsterField(this.world.engine, 1, testMode, stageId,
      rankedPreview ? this.previewWave : null);
    this.attachCollisions();
    this.launchAt = performance.now() + (testMode ? 20 : tuning.ball.launchDelayMs);
    this.lastFrame = performance.now();
    root.dataset.phase = this.run.phase;
    this.updateEvolutionUi();
    this.renderUpgradeUi();
  }

  private newEffect(isClone: boolean, fused = false): BallEffect {
    return {
      bombArmed: false,
      bombPower: 1,
      elasticMs: 0,
      pierceRemaining: 0,
      trail: [],
      isClone,
      remainingMs: isClone ? (fused ? 9500 : 6500) + this.combat.cloneDurationBonusMs : Infinity,
    };
  }

  private attachCollisions(): void {
    const engine = this.world.engine;
    this.collisionHandler = event => {
      if (this.run.phase !== 'RUNNING') return;
      const now = performance.now();
      const paddleContacts: { ball: Body; other: Body; part: Body; index: number }[] = [];

      for (const pair of event.pairs) {
        const a = pair.bodyA.parent;
        const b = pair.bodyB.parent;
        const ball = a.label === 'ball' ? a : b.label === 'ball' ? b : null;
        if (!ball || !this.ball.has(ball)) continue;
        const other = ball === a ? b : a;
        const part = pair.bodyA.parent === other ? pair.bodyA
          : pair.bodyB.parent === other ? pair.bodyB : other;
        if (other.label === 'living-duck') {
          paddleContacts.push({ ball, other, part, index: this.paddle.bodies.indexOf(other) });
        }
      }

      paddleContacts.sort((a, b) => {
        const ta = a.other.parts[1] ?? a.other;
        const tb = b.other.parts[1] ?? b.other;
        const da = Math.hypot(a.ball.position.x - ta.position.x, a.ball.position.y - ta.position.y);
        const db = Math.hypot(b.ball.position.x - tb.position.x, b.ball.position.y - tb.position.y);
        return da - db || a.index - b.index;
      });
      const paddleHits = new Map<number, (typeof paddleContacts)[number]>();
      for (const contact of paddleContacts) if (!paddleHits.has(contact.ball.id)) paddleHits.set(contact.ball.id, contact);

      if (paddleHits.size) {
        this.combo = 0;
      }
      for (const hit of paddleHits.values()) {
        if (this.equipmentId === 'landing-chalk' && !this.effects.get(hit.ball.id)?.isClone)
          this.chalkAvailable = false;
        const kind = this.paddle.onBallHit(hit.ball, hit.part);
        const effect = this.effects.get(hit.ball.id)!;
        const fused = this.paddle.fusionTiers[hit.index] === 2;
        effect.bombArmed = kind === 'bomb';
        effect.bombPower = fused ? 2 : 1;
        effect.elasticMs = kind === 'elastic' ? (fused ? 750 : 500) : 0;
        effect.pierceRemaining = kind === 'pierce' ? (fused ? 3 : 1) : 0;
        if (stageId === 3) {
          const mask = hit.ball.collisionFilter.mask ?? 0xffffffff;
          hit.ball.collisionFilter.mask = kind === 'pierce'
            ? mask & ~BOOKSHELF_CATEGORY : mask | BOOKSHELF_CATEGORY;
        }
        effect.trail.length = 0;
        if (kind === 'clone') this.pendingClone.push({ ball: hit.ball, fused });
        this.impact = kind === 'elastic' || kind === 'pierce' || kind === 'bomb' || kind === 'clone'
          ? { x: hit.other.position.x, y: hit.other.position.y, kind, ms: 290 } : null;
      }

      const lost = new Set<Body>();
      for (const pair of event.pairs) {
        const a = pair.bodyA.parent;
        const b = pair.bodyB.parent;
        const ball = a.label === 'ball' ? a : b.label === 'ball' ? b : null;
        if (!ball || !this.ball.has(ball)) continue;
        const other = ball === a ? b : a;

        if (other.label === 'p4-monster') {
          const effect = this.effects.get(ball.id)!;
          const attack = Math.max(1, Math.round(this.combat.ballAttack
            * (effect.isClone ? this.combat.cloneDamageMultiplier : 1)));
          const hit = this.monsters.hit(other, attack,
            effect.pierceRemaining > 0
              ? Math.max(this.combat.pierceDefenseIgnore, stageId === 3 ? 14 : 0) : 0,
            this.preCollisionVelocity.get(ball.id), ball.position.x);
          if (!hit) continue;
          if (hit.destroyed && hit.reward) this.onMonsterKilled(other, ball, false);
          else this.xpPopups.push({ x: other.position.x, y: other.position.y,
            label: `-${hit.damage} HP`, ms: 650 });
          if (this.freezeEnabled && !hit.destroyed
            && this.elapsedMs(now) - this.lastFreezeAt >= ANNIVERSARY_FREEZE_COOLDOWN_MS
            && this.monsters.freeze(other)) {
            this.lastFreezeAt = this.elapsedMs(now);
          }
          this.lastMonsterHitAt.set(ball.id, now);
          this.topSince.delete(ball.id);
          if (effect.pierceRemaining > 0) {
            const incoming = this.preCollisionVelocity.get(ball.id);
            if (incoming) this.pendingPierceVelocity.set(ball.id, incoming);
            effect.pierceRemaining -= 1;
            this.piercePasses += 1;
          }
          if (effect.bombArmed) {
            effect.bombArmed = false;
            effect.trail.length = 0;
            const splashAttack = Math.max(1, Math.round(this.combat.ballAttack * this.combat.bombMultiplier));
            const bonus = this.monsters.hitNearest(other, effect.bombPower, splashAttack);
            const neighbors: { x: number; y: number }[] = [];
            for (const target of bonus) {
              if (target.destroyed && target.reward) this.onMonsterKilled(target.body, ball, true);
              neighbors.push({ x: target.body.position.x, y: target.body.position.y });
            }
            this.blast = { x: other.position.x, y: other.position.y, neighbors, ms: 370 };
          }
        } else if (other.label === 'lose-sensor' && !paddleHits.has(ball.id)) {
          lost.add(ball);
        }
      }

      for (const body of lost) this.removeBall(body);
      if (this.ball.bodies.length === 0) this.finish('LOST');
    };
    Events.on(engine, 'collisionStart', this.collisionHandler);
  }

  private onMonsterKilled(monster: Body, ball: Body, bombBonus: boolean): void {
    if (rankedPreview) this.previewKills += 1;
    const gained = this.growth.monsterKilled(monster.position.x, monster.position.y);
    if (gained > 0) {
      this.xpPopups.push({ x: monster.position.x, y: monster.position.y, label: `+${gained} XP`, ms: 850 });
    }
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const effect = this.effects.get(ball.id);
    if (bombBonus) this.bombBonusKills += 1;
    if (effect?.isClone) this.cloneBonusKills += 1;
    if (this.growth.pending) {
      this.xpPopups.push({ x: this.paddle.getCenterX(), y: 474, label: `LV.${this.growth.level} 진화 가능!`, ms: 950 });
    }
  }

  private detachCollisions(): void {
    if (!this.collisionHandler) return;
    Events.off(this.world.engine, 'collisionStart', this.collisionHandler);
    this.collisionHandler = undefined;
  }

  private removeBall(body: Body): void {
    this.ball.remove(body);
    this.effects.delete(body.id);
    this.lastMonsterHitAt.delete(body.id);
    this.topSince.delete(body.id);
    this.preCollisionVelocity.delete(body.id);
    this.pendingPierceVelocity.delete(body.id);
    this.pendingClone = this.pendingClone.filter(item => item.ball !== body);
  }

  private openEvolution(now: number): void {
    if (this.run.phase !== 'RUNNING' || !this.growth.pending) return;
    this.run.transition('CHOOSING');
    this.pauseClock(now);
    this.input.reset(this.paddle.getCenterX());
    this.selectedKind = null;
    this.updateEvolutionUi();
    root.dataset.phase = this.run.phase;
  }

  private selectKind(kind: Exclude<DuckKind, 'basic'>): void {
    if (this.run.phase !== 'CHOOSING') return;
    this.selectedKind = kind;
    this.updateEvolutionUi();
  }

  private openUpgrade(level: number, now: number): void {
    if (this.run.phase !== 'RUNNING') return;
    this.upgradeLevel = level;
    this.upgradeOffer = offerUpgradeCards(level, this.paddle.kinds, this.runSeed, stageId);
    this.run.transition('UPGRADING');
    this.pauseClock(now);
    this.input.reset(this.paddle.getCenterX());
    this.renderUpgradeUi();
    root.dataset.phase = this.run.phase;
  }

  private chooseUpgrade(id: UpgradeCardId): void {
    if (this.run.phase !== 'UPGRADING' || this.upgradeLevel === null
      || !this.upgradeOffer.some(card => card.id === id)) return;
    applyUpgradeCard(this.combat, id);
    if (stageId === 5 && id === 'freeze-training') this.freezeEnabled = true;
    this.awardedUpgradeLevels.add(this.upgradeLevel);
    this.pickedCards.push(id);
    this.upgradeLevel = null;
    this.upgradeOffer = [];
    this.run.transition('RUNNING');
    const now = performance.now();
    this.resumeClock(now);
    this.input.reset(this.paddle.getCenterX());
    root.dataset.phase = this.run.phase;
    this.renderUpgradeUi();
    this.processGrowthEvents(now);
  }

  private rerollCard(slot: number): void {
    if (this.run.phase !== 'UPGRADING' || this.equipmentId !== 'choice-notebook'
      || this.notebookUsed || this.upgradeLevel !== 2) return;
    const next = rerollUpgradeCard(this.upgradeOffer, slot, this.paddle.kinds, this.runSeed, stageId);
    if (!next) return;
    this.upgradeOffer = next;
    this.notebookUsed = true;
    this.renderUpgradeUi();
  }

  private processGrowthEvents(now: number): void {
    if (this.run.phase !== 'RUNNING') return;
    for (let level = 2; level <= this.growth.level; level += 1) {
      if (level === 3 && this.growth.evolutions < 1) {
        this.openEvolution(now);
        return;
      }
      if (level === 6 && this.growth.evolutions < 2) {
        this.openEvolution(now);
        return;
      }
      if (level % 3 !== 0 && !this.awardedUpgradeLevels.has(level)) {
        this.openUpgrade(level, now);
        return;
      }
    }
  }

  private renderUpgradeUi(): void {
    const active = this.run.phase === 'UPGRADING';
    upgradePanel.hidden = !active;
    if (!active || this.upgradeLevel === null) {
      upgradeCardsEl.innerHTML = '';
      delete upgradeCardsEl.dataset.offerKey;
      rerollHelpEl.textContent = '';
      return;
    }
    upgradeLevelEl.textContent = `Lv.${this.upgradeLevel} 성장 카드 3택1`;
    const canReroll = this.equipmentId === 'choice-notebook' && this.upgradeLevel === 2 && !this.notebookUsed;
    rerollHelpEl.textContent = canReroll ? '선택 노트 · 카드 하나를 한 번만 재추첨할 수 있어요.' : '';
    const offerKey = `${this.upgradeLevel}:${this.upgradeOffer.map(card => card.id).join(',')}:${canReroll}`;
    if (upgradeCardsEl.dataset.offerKey === offerKey) return;
    upgradeCardsEl.dataset.offerKey = offerKey;
    upgradeCardsEl.innerHTML = this.upgradeOffer.map((card, index) => `
      <div class="upgrade-choice"><button type="button" class="upgrade-card" data-upgrade-card="${card.id}">
        <small>${index + 1} · ${card.tag}</small>
        <strong>${card.title}</strong>
        <span>${card.description}</span>
      </button>${canReroll && !(stageId === 5 && index === 2 && card.id === 'freeze-training')
        ? `<button type="button" class="reroll-button" data-reroll-slot="${index}">↻ 재추첨</button>` : ''}</div>`).join('');
  }

  chooseEvolution(kind: Exclude<DuckKind, 'basic'>, index: number): void {
    if (this.run.phase !== 'CHOOSING') return;
    const source = this.growth.evolutions === 1 ? this.paddle.fuseAdjacentDuck(index, kind) : null;
    if (source === null && !this.paddle.evolveDuck(index, kind)) return;
    if (source !== null) {
      this.fusionCount += 1;
      const duck = this.paddle.bodies[source];
      this.mergeBurst = { x: duck.position.x, y: duck.position.y - 23, kind, ms: 950 };
    }
    this.growth.evolve();
    this.selectedKind = null;
    this.run.transition('RUNNING');
    const now = performance.now();
    this.resumeClock(now);
    this.input.reset(this.paddle.getCenterX());
    root.dataset.phase = this.run.phase;
    this.updateEvolutionUi();
    this.processGrowthEvents(now);
  }

  private startNextArea(): void {
    this.monsters.destroy();
    if (rankedPreview) this.previewWave += 1;
    else this.area = (this.area + 1) as BackGateArea;
    this.areaCleared = false;
    this.growth.startArea2();
    this.chalkAvailable = this.equipmentId === 'landing-chalk';
    this.monsters = new MonsterField(this.world.engine, this.area, testMode, stageId,
      rankedPreview ? this.previewWave : null);
    this.pendingClone = [];
    this.ball.destroy();
    this.ball = new BallSystem(this.world.engine);
    this.ball.launch();
    this.effects.clear();
    this.effects.set(this.ball.body.id, this.newEffect(false));
    this.lastMonsterHitAt.clear();
    this.topSince.clear();
    this.preCollisionVelocity.clear();
    this.pendingPierceVelocity.clear();
    this.combo = 0;
    this.xpPopups = [];
  }

  private togglePause(): void {
    const now = performance.now();
    if (this.run.phase === 'RUNNING') {
      this.run.transition('PAUSED');
      this.pauseClock(now);
    } else if (this.run.phase === 'PAUSED') {
      this.run.transition('RUNNING');
      this.resumeClock(now);
      this.input.reset(this.paddle.getCenterX());
      this.lastFrame = now;
    } else return;
    root.dataset.phase = this.run.phase;
  }

  private pauseClock(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now;
  }

  private resumeClock(now: number): void {
    if (this.pausedAt === null) return;
    this.pausedTotal += Math.max(0, now - this.pausedAt);
    this.pausedAt = null;
  }

  private elapsedMs(now = performance.now()): number {
    if (!this.startedAt) return 0;
    return Math.max(0, (this.pausedAt ?? now) - this.startedAt - this.pausedTotal);
  }

  private finish(next: 'CLEAR' | 'LOST'): void {
    if (this.run.phase !== 'RUNNING') return;
    this.run.transition(next);
    if (!rankedPreview && hubEntry?.result() && next === 'CLEAR') hubEntry.clear();
    this.pauseClock(performance.now());
    this.pendingClone = [];
    if (!rankedPreview && !this.runRecorded) {
      const evolvedKind = [...this.paddle.kinds].reverse().find(kind => kind !== 'basic') ?? null;
      this.account.recordRun({
        result: next,
        wave: this.area,
        level: this.growth.level,
        evolutions: this.growth.evolutions,
        evolvedKind,
        campaign: { stageId, remainingHp: this.combat.hp,
          durationMs: this.elapsedMs(), level: this.growth.level,
          maxCombo: this.maxCombo, fusionCount: this.fusionCount, equipmentId: this.equipmentId },
      });
      this.runRecorded = true;
    }
    this.ball.bodies.forEach(body => Body.setVelocity(body, { x: 0, y: 0 }));
    root.dataset.phase = this.run.phase;
  }

  restart(): void {
    if (this.run.phase !== 'CLEAR' && this.run.phase !== 'LOST') return;
    if (!rankedPreview) hubEntry?.retry();
    this.run.transition('READY');
    this.buildRun();
  }

  private handleAreaCompletion(): void {
    if (!this.monsters.complete || this.areaCleared || this.run.phase !== 'RUNNING') return;
    this.areaCleared = true;
    if (rankedPreview) {
      this.completedWaves = this.previewWave;
      this.startNextArea();
    } else if (this.area < (stageId === 6 ? 4 : 2)) this.startNextArea();
    else this.finish('CLEAR');
  }

  private applyAntiStall(body: Body, now: number): void {
    if (body.position.y >= 220) {
      this.topSince.delete(body.id);
      return;
    }
    if (!this.topSince.has(body.id)) this.topSince.set(body.id, now);
    const topSince = this.topSince.get(body.id)!;
    const lastHit = this.lastMonsterHitAt.get(body.id) ?? this.startedAt;
    if (now - topSince < 3000 || now - lastHit < 3000) return;

    const speed = Math.max(tuning.ball.minSpeed, Math.min(tuning.ball.maxSpeed,
      Math.hypot(body.velocity.x, body.velocity.y) || tuning.ball.speed));
    const minDown = speed * 0.35;
    const vy = Math.max(minDown, Math.abs(body.velocity.y));
    const xMagnitude = Math.sqrt(Math.max(0, speed * speed - Math.min(speed, vy) ** 2));
    Body.setVelocity(body, { x: (Math.sign(body.velocity.x) || 1) * xMagnitude, y: Math.min(speed, vy) });
    this.antiStallRescues += 1;
    this.topSince.set(body.id, now);
    this.lastMonsterHitAt.set(body.id, now);
  }

  private updateEvolutionUi(): void {
    const choosing = this.run.phase === 'CHOOSING';
    evolutionPanel.hidden = !choosing;
    if (!choosing) return;

    (root.querySelector('[data-ui="evolution-title"]') as HTMLElement).textContent =
      this.growth.evolutions ? '두 번째 진화!' : '첫 진화!';
    evolutionPanel.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.kind === this.selectedKind));
    });
    evolutionPanel.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((button, index) => {
      const unavailable = this.paddle.kinds[index] !== 'basic';
      button.disabled = unavailable;
      const source = this.growth.evolutions === 1 && this.selectedKind
        ? adjacentFusionSource(this.paddle.kinds, index, this.selectedKind) : null;
      button.dataset.fusion = String(source !== null && this.paddle.fusionTiers[source] === 1);
    });
    (root.querySelector('[data-ui="evolution-help"]') as HTMLElement).textContent =
      this.growth.evolutions
        ? '같은 능력의 인접 오리를 고르면 5→4 물리 합체 · 방향키 + 숫자키 지원'
        : '첫 능력을 고른 뒤 오리 1~5를 선택 · 방향키 + 숫자키 지원';
  }

  private updateHud(): void {
    const phase = this.run.phase;
    defenceEl.className = 'p4-hp';
    defenceEl.textContent = `HP ${this.combat.hp}/${this.combat.maxHp}`;
    const fragments = stageId === 4 || stageId === 5 || stageId === 6
      ? this.monsters.views.filter(monster => monster.kind === 'fragment').length : 0;
    progressEl.textContent = rankedPreview
      ? `Wave ${this.previewWave} · ${this.monsters.resolvedCount}/${this.monsters.target} · 처치 ${this.previewKills}`
      : `Area ${this.area}/${stageId === 6 ? 4 : 2} · ${this.monsters.resolvedCount}/${this.monsters.target}`
      + (fragments ? ` · 파편 ${fragments}` : '')
      + (stageId === 4 && this.monsters.bossPartsCleared ? ` · 조별과제 ${this.monsters.bossPartsCleared}/3` : '')
      + (stageId === 6 && this.area === 4
        ? ` · 졸업논문 ${this.monsters.finalPhase}/5 ${FINAL_PHASE_NAMES[this.monsters.finalPhase]}` : '');
    statsEl.className = 'p4-combat';
    statsEl.textContent = `🛡${this.combat.defense} · ⚔${this.combat.ballAttack} · C${this.combo}`;
    equipmentEl.textContent = this.equipmentId === 'feather-recovery'
      ? `🎒 회수 가방 ${this.growth.recoveryRemaining}/1`
      : this.equipmentId === 'landing-chalk' ? `✎ 착지 분필 ${this.chalkAvailable ? '예측 중' : '사용 완료'}`
        : this.equipmentId === 'choice-notebook' ? `📓 선택 노트 ${this.notebookUsed ? '사용 완료' : '1/1'}` : '';
    growthLevelEl.textContent = `LV.${this.growth.level} · XP ${this.growth.xp}/${this.growth.targetXp}`;
    growthMeterEl.setAttribute('aria-valuenow', String(this.growth.xp));
    growthMeterEl.setAttribute('aria-valuemax', String(this.growth.targetXp));
    growthFillEl.style.width = `${Math.min(100, this.growth.xp / this.growth.targetXp * 100)}%`;

    pauseButton.hidden = phase !== 'RUNNING';
    pausePanel.hidden = phase !== 'PAUSED';
    resultPanel.hidden = phase !== 'CLEAR' && phase !== 'LOST';
    if (!resultPanel.hidden) {
      if (rankedPreview) {
        resultCopy.innerHTML = `<strong>연습 종료 · Wave ${this.previewWave}</strong>
          <p>완료 ${this.completedWaves} Wave · 처치 ${this.previewKills} · 침입 ${this.totalBreaches}</p>
          <p>생존 ${(this.elapsedMs() / 1000).toFixed(1)}초 · 최대 콤보 ${this.maxCombo} · HP ${this.combat.hp}/${this.combat.maxHp}</p>
          <p>연습 결과는 저장되지 않으며 공식 랭킹에 반영되지 않습니다.</p>`;
        return;
      }
      const stars = this.account.getProgress().campaign.stages[stageId]?.goals.length ?? 0;
      resultCopy.innerHTML = `<strong>${phase}</strong>
        ${phase === 'LOST' && stageId === 4 && this.monsters.bossBreached
          ? '<p>조별과제 파트가 위험선에 도달했습니다.</p>' : ''}
        ${phase === 'LOST' && stageId === 5 && this.monsters.eliteBreached
          ? '<p>Elite가 위험선에 도달했습니다.</p>' : ''}
        ${phase === 'LOST' && stageId === 6 && this.monsters.finalBreached
          ? '<p>졸업논문 또는 Elite가 위험선에 도달했습니다.</p>' : ''}
        ${phase === 'CLEAR' ? `<p>${stageName} 도전 ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} · 누적 ${stars}/3</p>` : ''}
        <p>시간 ${(this.elapsedMs() / 1000).toFixed(1)}초 · 최대 콤보 ${this.maxCombo}</p>
        <p>처치 ${this.monsters.defeatedCount} · 침입 ${this.totalBreaches} · HP ${this.combat.hp}/${this.combat.maxHp}</p>
        <p>ATK ${this.combat.ballAttack} · DEF ${this.combat.defense} · 카드 ${this.pickedCards.length}장</p>
        <p>폭탄 추가처치 ${this.bombBonusKills} · 복제공 처치 ${this.cloneBonusKills}</p>
        ${this.equipmentId ? `<p>장비 ${EQUIPMENT.find(item => item.id === this.equipmentId)?.name}</p>` : ''}
        <p>상단 정체 구조 ${this.antiStallRescues}회</p>`;
    }
    this.updateEvolutionUi();
    this.renderUpgradeUi();
  }

  private loop = (now: number): void => {
    const delta = Math.min(33.333, Math.max(8, now - this.lastFrame));
    this.lastFrame = now;
    const targetX = this.run.phase === 'PAUSED' || this.run.phase === 'CHOOSING'
      || this.run.phase === 'UPGRADING'
      ? this.paddle.getCenterX() : this.input.update(now);

    if (this.run.phase === 'READY' && now >= this.launchAt) {
      this.run.transition('RUNNING');
      this.startedAt = now;
      this.ball.launch();
      this.ball.bodies.forEach(body => this.lastMonsterHitAt.set(body.id, now));
      root.dataset.phase = this.run.phase;
    }

    if (this.run.phase === 'RUNNING') {
      this.effectTimeMs += delta;
      this.xpPopups = this.xpPopups.filter(item => (item.ms -= delta) > 0);
      for (const effect of this.effects.values()) effect.elasticMs = Math.max(0, effect.elasticMs - delta);
      if (this.impact && (this.impact.ms -= delta) <= 0) this.impact = null;
      if (this.blast && (this.blast.ms -= delta) <= 0) this.blast = null;
      if (this.mergeBurst && (this.mergeBurst.ms -= delta) <= 0) this.mergeBurst = null;

      this.paddle.update(targetX, delta);
      const breachAttacks = this.monsters.update(delta);
      if (breachAttacks.length) {
        for (const attack of breachAttacks) applyBreachDamage(this.combat, attack);
        this.totalBreaches += breachAttacks.length;
        this.combo = 0;
        if (this.combat.hp <= 0 || this.monsters.bossBreached
          || this.monsters.eliteBreached || this.monsters.finalBreached) this.finish('LOST');
      }

      if (this.run.phase === 'RUNNING') {
        this.preCollisionVelocity.clear();
        for (const body of this.ball.bodies) {
          this.preCollisionVelocity.set(body.id, { x: body.velocity.x, y: body.velocity.y });
        }
        Engine.update(this.world.engine, delta);
        for (const [id, velocity] of this.pendingPierceVelocity) {
          const body = this.ball.bodies.find(candidate => candidate.id === id);
          if (body) Body.setVelocity(body, velocity);
        }
        this.pendingPierceVelocity.clear();
        this.paddle.stabilize();

        const beforeXp = this.growth.totalXp;
        const caught = this.growth.update(delta, this.paddle.bodies,
          this.combat.featherXp, this.combat.featherPickupBonus);
        let gained = this.growth.totalXp - beforeXp;
        for (const index of caught) {
          const amount = Math.min(this.combat.featherXp, gained);
          if (!amount) break;
          gained -= amount;
          const duck = this.paddle.bodies[index];
          this.xpPopups.push({ x: duck.position.x, y: duck.position.y - 34, label: `+${amount} XP`, ms: 850 });
        }

        for (const { ball, fused } of this.pendingClone) {
          const clone = this.ball.spawnClone(ball);
          if (clone) {
            this.effects.set(clone.id, this.newEffect(true, fused));
            this.lastMonsterHitAt.set(clone.id, now);
          }
        }
        this.pendingClone = [];

        for (const body of [...this.ball.bodies]) {
          const effect = this.effects.get(body.id)!;
          if (stageId === 3 && effect.pierceRemaining === 0
            && !((body.collisionFilter.mask ?? 0xffffffff) & BOOKSHELF_CATEGORY)
            && this.monsters.obstacles.every(obstacle => !Bounds.overlaps(body.bounds, obstacle.bounds))) {
            body.collisionFilter.mask = (body.collisionFilter.mask ?? 0xffffffff) | BOOKSHELF_CATEGORY;
          }
          if (effect.isClone) {
            effect.remainingMs -= delta;
            if (effect.remainingMs <= 0) {
              this.removeBall(body);
              continue;
            }
          }
          this.ball.clampSpeed(body);
          this.applyAntiStall(body, now);
          if (effect.bombArmed || effect.elasticMs > 0 || effect.pierceRemaining > 0 || effect.isClone) {
            effect.trail.push({ x: body.position.x, y: body.position.y });
            if (effect.trail.length > 7) effect.trail.shift();
          } else {
            effect.trail.length = 0;
          }
        }

        if (this.ball.bodies.length === 0) this.finish('LOST');
        if (this.run.phase === 'RUNNING') this.processGrowthEvents(now);
        if (this.run.phase === 'RUNNING') this.handleAreaCompletion();
      }
    } else if (this.run.phase !== 'PAUSED' && this.run.phase !== 'CHOOSING'
      && this.run.phase !== 'UPGRADING') {
      this.paddle.update(targetX, delta);
      Engine.update(this.world.engine, delta);
      this.paddle.stabilize();
    }

    this.updateHud();
    this.renderer.render({
      balls: this.ball.bodies.map(body => ({ body, ...this.effects.get(body.id)! })),
      paddleBodies: this.paddle.bodies,
      paddleConstraints: this.paddle.constraints,
      bricks: [],
      monsters: this.monsters.views,
      obstacles: this.monsters.obstacles,
      stageZones: stageId === 6 ? this.area === 1 ? ['후문 길목', '가로등']
        : this.area === 2 ? ['야간 추격', 'Elite']
          : this.area === 3 ? ['후문 앞', '복합 전선'] : ['교문 앞', '졸업논문']
        : stageId === 5 ? this.area === 1 ? ['로비 전시', '전시대'] : ['강의구역', '성과 발표']
        : stageId === 4 ? this.area === 1 ? ['5남', '5동'] : ['5서', '5북'] : undefined,
      cosmeticId: this.cosmeticId,
      landingX: this.landingX(),
      dangerLineY: this.monsters.dangerLineY,
      feathers: this.growth.feathers,
      xpPopups: this.xpPopups,
      mode: 'living',
      phase: this.run.phase,
      targetX,
      showColliders: testMode,
      duckHitFlash: this.paddle.getHitFlash(),
      duckKinds: this.paddle.kinds,
      fusionTiers: this.paddle.fusionTiers,
      effectTimeMs: this.effectTimeMs,
      impact: this.impact,
      blast: this.blast,
      mergeBurst: this.mergeBurst,
    });

    if (testMode) this.publishDebug();
    this.raf = requestAnimationFrame(this.loop);
  };

  private publishDebug(): void {
    const debug: P4Debug = {
      phase: this.run.phase,
      previewWave: rankedPreview ? this.previewWave : null,
      completedWaves: this.completedWaves,
      previewKills: this.previewKills,
      area: this.area,
      defence: this.combat.defense,
      hp: this.combat.hp,
      maxHp: this.combat.maxHp,
      ballAttack: this.combat.ballAttack,
      breachShield: this.combat.breachShield,
      upgradeLevel: this.upgradeLevel,
      upgradeOffer: this.upgradeOffer.map(card => card.id),
      pickedCards: [...this.pickedCards],
      monsterCount: this.monsters.activeCount,
      resolved: this.monsters.resolvedCount,
      target: this.monsters.target,
      defeated: this.monsters.defeatedCount,
      breached: this.monsters.breachedCount,
      xp: this.growth.xp,
      xpTarget: this.growth.targetXp,
      totalXp: this.growth.totalXp,
      level: this.growth.level,
      nextEvolutionLevel: this.growth.nextEvolutionLevel,
      evolutions: this.growth.evolutions,
      evolutionPending: this.growth.pending,
      ducks: this.paddle.bodies.length,
      duckKinds: [...this.paddle.kinds],
      fusionTiers: [...this.paddle.fusionTiers],
      activeBalls: this.ball.bodies.length,
      combo: this.combo,
      maxCombo: this.maxCombo,
      antiStallRescues: this.antiStallRescues,
      bombBonusKills: this.bombBonusKills,
      cloneBonusKills: this.cloneBonusKills,
      piercePasses: this.piercePasses,
      pierceRemaining: Math.max(0, ...[...this.effects.values()].map(effect => effect.pierceRemaining)),
      bossPartsCleared: this.monsters.bossPartsCleared,
      bossBreached: this.monsters.bossBreached,
      eliteBreached: this.monsters.eliteBreached,
      finalBreached: this.monsters.finalBreached,
      finalPhase: this.monsters.finalPhase,
      freezeEnabled: this.freezeEnabled,
      monsterPositions: this.monsters.views.map(({ body, kind, hp, maxHp, attack, defense, frozen }) => ({
        x: body.position.x, y: body.position.y, kind, hp, maxHp, attack, defense, frozen,
      })),
      ballPositions: this.ball.bodies.map(body => ({ x: body.position.x, y: body.position.y })),
      ballVelocities: this.ball.bodies.map(body => ({ x: body.velocity.x, y: body.velocity.y })),
      equipmentId: this.equipmentId,
      cosmeticId: this.cosmeticId,
      recoveryRemaining: this.growth.recoveryRemaining,
      recoveredCount: this.growth.recoveredCount,
      chalkAvailable: this.chalkAvailable,
      landingX: this.landingX(),
      notebookUsed: this.notebookUsed,
    };
    (window as Window & { __INDUCKUP_P4__?: P4Debug }).__INDUCKUP_P4__ = debug;
  }

  private landingX(): number | null {
    if (!this.chalkAvailable || this.run.phase !== 'RUNNING') return null;
    const ball = this.ball.bodies.find(body => !this.effects.get(body.id)?.isClone);
    return ball ? projectedLandingX(ball.position.x, ball.position.y, ball.velocity.x, ball.velocity.y) : null;
  }

  setBallForTest(x: number, y: number, vx: number, vy: number, index = 0): void {
    if (!testMode || this.run.phase !== 'RUNNING') return;
    const body = this.ball.bodies[index];
    if (!body) return;
    Body.setPosition(body, { x, y });
    Body.setVelocity(body, { x: vx, y: vy });
  }

  grantXpForTest(amount: number): void {
    if (!testMode || this.run.phase !== 'RUNNING') return;
    this.growth.addXp(amount);
  }

  chooseUpgradeForTest(id?: UpgradeCardId): void {
    if (!testMode || this.run.phase !== 'UPGRADING') return;
    const card = id ? this.upgradeOffer.find(item => item.id === id) : this.upgradeOffer[0];
    if (card) this.chooseUpgrade(card.id);
  }

  openEvolutionForTest(): void {
    if (!testMode || !this.growth.pending || this.run.phase !== 'RUNNING') return;
    this.openEvolution(performance.now());
  }

  completeAreaForTest(): void {
    if (!testMode || this.run.phase !== 'RUNNING') return;
    this.monsters.forceCompleteForTest();
  }

  breachForTest(kind?: LakeMonsterKind): void {
    if (!testMode || this.run.phase !== 'RUNNING') return;
    this.monsters.forceBreachForTest(kind);
  }

  forceLoseForTest(): void {
    if (testMode && this.run.phase === 'RUNNING') this.finish('LOST');
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.detachCollisions();
    this.input.destroy();
    window.removeEventListener('keydown', this.onKeyDown);
    this.paddle.destroy(this.world.engine);
    this.ball.destroy();
    this.monsters.destroy();
    Engine.clear(this.world.engine);
  }
}

const game = new LakePreviewGame();
hubEntry?.landing();
hubEntry?.play();

if (testMode) {
  (window as Window & {
    __INDUCKUP_P4_TEST_API__?: {
      setBall(x: number, y: number, vx: number, vy: number, index?: number): void;
      grantXp(amount: number): void;
      openEvolution(): void;
      choose(kind: Exclude<DuckKind, 'basic'>, index: number): void;
      chooseUpgrade(id?: UpgradeCardId): void;
      completeArea(): void;
      breach(kind?: LakeMonsterKind): void;
      forceLose(): void;
      restart(): void;
    };
  }).__INDUCKUP_P4_TEST_API__ = {
    setBall: (x, y, vx, vy, index) => game.setBallForTest(x, y, vx, vy, index),
    grantXp: amount => game.grantXpForTest(amount),
    openEvolution: () => game.openEvolutionForTest(),
    choose: (kind, index) => game.chooseEvolution(kind, index),
    chooseUpgrade: id => game.chooseUpgradeForTest(id),
    completeArea: () => game.completeAreaForTest(),
    breach: kind => game.breachForTest(kind),
    forceLose: () => game.forceLoseForTest(),
    restart: () => game.restart(),
  };
}

window.addEventListener('pagehide', () => game.destroy(), { once: true });
