import { Body, Composite, Engine, Events } from 'matter-js';
import './styles.css';
import { BallSystem } from './game/ball/BallSystem';
import { BrickField } from './game/bricks/BrickField';
import { tuning } from './game/config/tuning';
import { createRunState } from './game/core/runState';
import type { DebugSnapshot, PaddleRuntime, PilotMode } from './game/core/types';
import type { BrickPattern } from './game/bricks/BrickField';
import { InputController } from './game/input/InputController';
import { LivingPaddle } from './game/paddle/LivingPaddle';
import type { FlockLayout } from './game/paddle/duckTypes';
import type { ElasticMode } from './game/paddle/duckPhysics';
import { RigidPaddle } from './game/paddle/RigidPaddle';
import { createWorld } from './game/physics/createWorld';
import { GameRenderer } from './game/render/GameRenderer';
import { PilotTelemetry } from './game/telemetry/PilotTelemetry';
import { FeatherGrowth } from './game/growth/FeatherGrowth';
import type { DuckKind } from './game/paddle/duckTypes';
import { InhaGameAccount } from './account/InhaGameAccount';
import { Hud } from './ui/Hud';

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Missing #app root');
const root: HTMLElement = appRoot;

root.innerHTML = `
  <section class="pilot-shell">
    <header class="pilot-header">
      <div class="pilot-title-row">
        <h1>인덕업 🦆⬆️</h1>
        <button class="account-chip" type="button" data-account-open>👤 <span data-account-label>계정</span></button>
      </div>
      <p>깃털 XP를 모아 두 판에 걸쳐 오리 두 마리를 진화시키세요.</p>
    </header>
    <div class="game-card" data-game-surface>
      <canvas aria-label="인덕업 오리 성장 게임 화면"></canvas>
      <div class="hud" data-hud></div>
    </div>
    <footer class="pilot-footer">
      <span>드래그 · A/D · ←/→ · P/ㅔ 일시정지 · R/ㄱ 다시하기</span>
      <span data-foot-mode></span>
      <a href="https://duck.inhagame.app/privacy.html" target="_blank" rel="noopener noreferrer">개인정보 처리방침</a>
    </footer>
    <nav class="flock-choices" aria-label="오리 배치 비교">
      <a href="?flock=A" data-layout="A">A · 양끝 특수</a>
      <a href="?flock=B" data-layout="B">B · 안쪽 특수</a>
      <a href="?flock=off" data-layout="off">기본 오리 5</a>
    </nav>
    <nav class="experiment-choices" aria-label="능력과 벽돌 비교">
      <a data-experiment="elastic:standard">탄성 기본</a>
      <a data-experiment="elastic:strong">탄성 강화</a>
      <a data-experiment="bricks:classic">기본 벽돌</a>
      <a data-experiment="bricks:clusters">군집 벽돌</a>
      <a data-experiment="clone:1">복제 켜기</a>
      <a data-experiment="clone:0">복제 끄기</a>
    </nav>
    <p class="duck-key">벽돌 파괴 XP +1 · 오리 몸통으로 깃털 받기 XP +2</p>
    <div class="account-overlay" data-account-overlay hidden>
      <section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="induckup-account-title">
        <div class="account-head">
          <h2 id="induckup-account-title">👤 INHAGAME 계정</h2>
          <button type="button" data-account-close aria-label="닫기">×</button>
        </div>
        <p class="account-status" data-account-status>계정 상태 확인 중...</p>
        <div class="account-guest" data-account-guest>
          <div class="account-tabs" role="tablist" aria-label="계정 메뉴">
            <button type="button" class="account-tab active" data-account-tab="signup">회원가입</button>
            <button type="button" class="account-tab" data-account-tab="login">로그인</button>
          </div>
          <div class="account-auth-panel" data-account-signup-panel>
            <p>지금 게스트 기록을 그대로 유지하면서 INHAGAME 계정으로 승격합니다.</p>
            <label>이메일<input type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" data-account-signup-email></label>
            <button type="button" data-account-signup>1. 인증 메일 보내기</button>
            <button class="secondary" type="button" data-account-refresh>2. 인증 완료 확인</button>
            <p class="account-help">메일 인증이 끝나면 같은 계정 ID로 승격됩니다. 이후 비밀번호를 설정하면 가입이 완료됩니다.</p>
            <div class="account-privacy-notice">
              <strong>개인정보 수집·이용 내역</strong>
              <p>가입 시 이메일·계정 ID와 인증정보를 처리합니다. 비밀번호 원문은 게임 데이터베이스에 저장하지 않으며 계정 인증 서비스로 전달됩니다.</p>
              <details>
                <summary>게임 기록 등 처리 항목과 목적 보기</summary>
                <p>게스트 이용 시에도 계정 ID가 생성될 수 있습니다. 게임 진행도·플레이 기록은 계정과 연결되어 저장될 수 있으며 로그인과 클라우드 동기화에 이용됩니다. 인하오리 Classic의 랭킹 참여 시에는 닉네임·학과·점수·플레이 기록 및 방문/세션 식별자·이용 및 오류 이벤트가 운영과 장애 분석에 쓰입니다.</p>
              </details>
              <p><a href="https://duck.inhagame.app/privacy.html" target="_blank" rel="noopener noreferrer">개인정보 처리방침 전체 보기</a> · 문의 <a href="mailto:aldol@inha.edu">aldol@inha.edu</a></p>
            </div>
          </div>
          <div class="account-auth-panel" data-account-login-panel hidden>
            <label>이메일<input type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" data-account-login-email></label>
            <label>비밀번호<input type="password" autocomplete="current-password" minlength="8" placeholder="8자 이상" data-account-login-password></label>
            <button type="button" data-account-password-login>로그인</button>
            <button class="secondary" type="button" data-account-login-link>비밀번호 없는 계정 · 로그인 링크 받기</button>
          </div>
        </div>
        <div class="account-permanent" data-account-permanent hidden>
          <p class="account-email" data-account-address></p>
      <div class="account-inha-badge">
        <p data-inha-verified hidden>🎓 인하 메일 인증</p>
        <div data-inha-form>
          <label>인하대 메일 인증<input type="email" inputmode="email" autocomplete="email" placeholder="name@inha.edu" data-inha-email></label>
          <button type="button" class="secondary" data-inha-request>1. 6자리 코드 받기</button>
          <label>인증 코드<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6자리 숫자" data-inha-code></label>
          <button type="button" class="secondary" data-inha-confirm>2. 코드 확인하고 뱃지 받기</button>
          <p class="account-help">기존 로그인 이메일을 그대로 사용합니다. 인하대 메일 소유만 확인하며 재학 여부를 인증하지 않습니다.</p>
        </div>
      </div>
          <div class="account-progress" data-account-progress></div>
          <div class="account-password-setup">
            <strong>비밀번호 설정 / 변경</strong>
            <label>비밀번호<input type="password" autocomplete="new-password" minlength="8" placeholder="8자 이상" data-account-new-password></label>
            <label>비밀번호 확인<input type="password" autocomplete="new-password" minlength="8" placeholder="한 번 더 입력" data-account-new-password-confirm></label>
            <button type="button" data-account-set-password>비밀번호 저장</button>
          </div>
          <button class="secondary" type="button" data-account-sync>지금 기록 동기화</button>
          <button class="secondary" type="button" data-account-signout>이 게임에서 로그아웃</button>
          <p class="account-help">로그아웃 후 계정 진행도는 게스트 화면에서 숨겨지며, 같은 계정으로 다시 로그인하면 복구됩니다.</p>
        </div>
        <small>클라우드 진행도는 편의용 저장입니다. 경쟁 기록 검증과는 분리됩니다.</small>
      </section>
    </div>
  </section>`;

const surface = root.querySelector<HTMLElement>('[data-game-surface]')!;
const canvas = surface.querySelector<HTMLCanvasElement>('canvas')!;
const params = new URLSearchParams(location.search);
const mode: PilotMode = params.get('mode') === 'rigid' ? 'rigid' : 'living';
const growthEnabled = mode === 'living' && params.get('growth') !== '0';
const selectedLayout = params.get('flock');
const layout: FlockLayout = mode === 'rigid' ? 'off'
  : selectedLayout === 'B' || selectedLayout === 'off' ? selectedLayout : 'A';
const activeLayout: FlockLayout = growthEnabled ? 'off' : layout;
const testMode = params.get('test') === '1';
const cloneEnabled = mode === 'living' && params.get('clone') === '1';
const elasticMode: ElasticMode = params.get('elastic') === 'strong' ? 'strong' : 'standard';
const brickPattern: BrickPattern = params.get('bricks') === 'clusters' ? 'clusters' : 'classic';
root.querySelectorAll<HTMLAnchorElement>('[data-layout], [data-experiment]').forEach(link => {
  const next = new URLSearchParams(params);
  if (link.dataset.layout) next.set('flock', link.dataset.layout);
  if (link.dataset.experiment) {
    const [key, value] = link.dataset.experiment.split(':');
    next.set(key, value);
  }
  link.href = `?${next}`;
});
(root.querySelector('[data-foot-mode]') as HTMLElement).textContent = mode === 'living'
  ? growthEnabled ? '성장 실험 · 두 번 진화' : layout === 'off' ? 'P0 기준'
    : `배치 ${layout} · ${cloneEnabled ? '복제 실험' : 'P1'}` : 'Rigid baseline';
root.querySelector(`[data-layout="${layout}"]`)?.setAttribute('aria-current', 'page');
for (const choice of [`elastic:${elasticMode}`, `bricks:${brickPattern}`, `clone:${cloneEnabled ? '1' : '0'}`]) {
  root.querySelector(`[data-experiment="${choice}"]`)?.setAttribute('aria-current', 'page');
}
root.dataset.mode = mode;
(root.querySelector('.pilot-shell') as HTMLElement).dataset.growth = String(growthEnabled);

const account = new InhaGameAccount();
const accountOverlay = root.querySelector<HTMLElement>('[data-account-overlay]')!;
const accountStatus = root.querySelector<HTMLElement>('[data-account-status]')!;
const accountGuest = root.querySelector<HTMLElement>('[data-account-guest]')!;
const accountPermanent = root.querySelector<HTMLElement>('[data-account-permanent]')!;
const accountSignupPanel = root.querySelector<HTMLElement>('[data-account-signup-panel]')!;
const accountLoginPanel = root.querySelector<HTMLElement>('[data-account-login-panel]')!;
const accountSignupEmail = root.querySelector<HTMLInputElement>('[data-account-signup-email]')!;
const accountLoginEmail = root.querySelector<HTMLInputElement>('[data-account-login-email]')!;
const accountLoginPassword = root.querySelector<HTMLInputElement>('[data-account-login-password]')!;
const accountNewPassword = root.querySelector<HTMLInputElement>('[data-account-new-password]')!;
const accountNewPasswordConfirm = root.querySelector<HTMLInputElement>('[data-account-new-password-confirm]')!;
const accountAddress = root.querySelector<HTMLElement>('[data-account-address]')!;
const inhaEmail = root.querySelector<HTMLInputElement>('[data-inha-email]')!;
const inhaCode = root.querySelector<HTMLInputElement>('[data-inha-code]')!;
const inhaVerified = root.querySelector<HTMLElement>('[data-inha-verified]')!;
const inhaForm = root.querySelector<HTMLElement>('[data-inha-form]')!;
const accountProgress = root.querySelector<HTMLElement>('[data-account-progress]')!;
const accountLabel = root.querySelector<HTMLElement>('[data-account-label]')!;

account.subscribe(snapshot => {
  accountStatus.textContent = snapshot.message;
  const permanent = snapshot.state === 'permanent';
  accountGuest.hidden = permanent;
  accountPermanent.hidden = !permanent;
  accountLabel.textContent = permanent ? '연결됨' : '계정';
  if (permanent) {
    accountAddress.textContent = snapshot.email ?? '이메일 계정';
    inhaVerified.hidden = !snapshot.inhaVerified;
    inhaForm.hidden = snapshot.inhaVerified;
    accountProgress.textContent =
      `플레이 ${snapshot.progress.runsRecorded} · CLEAR ${snapshot.progress.clears} · 최고 LV.${snapshot.progress.bestLevel} · 진화 ${snapshot.progress.maxEvolutions}`;
  }
});
function setAccountMode(mode: 'signup' | 'login'): void {
  const signup = mode === 'signup';
  accountSignupPanel.hidden = !signup;
  accountLoginPanel.hidden = signup;
  root.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.accountTab === mode);
  });
}
root.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach(button => {
  button.onclick = () => setAccountMode(button.dataset.accountTab === 'login' ? 'login' : 'signup');
});
root.querySelector<HTMLButtonElement>('[data-account-open]')!.onclick = () => {
  accountOverlay.hidden = false;
  void account.init();
};
root.querySelector<HTMLButtonElement>('[data-account-close]')!.onclick = () => { accountOverlay.hidden = true; };
root.querySelector<HTMLButtonElement>('[data-account-signup]')!.onclick = () => { void account.beginSignup(accountSignupEmail.value); };
root.querySelector<HTMLButtonElement>('[data-account-password-login]')!.onclick = () => {
  void account.signInWithPassword(accountLoginEmail.value, accountLoginPassword.value);
};
root.querySelector<HTMLButtonElement>('[data-account-login-link]')!.onclick = () => {
  void account.signInExisting(accountLoginEmail.value);
};
root.querySelector<HTMLButtonElement>('[data-account-refresh]')!.onclick = () => { void account.refresh(); };
root.querySelector<HTMLButtonElement>('[data-account-set-password]')!.onclick = () => {
  void account.setPassword(accountNewPassword.value, accountNewPasswordConfirm.value);
};
root.querySelector<HTMLButtonElement>('[data-inha-request]')!.onclick = () => {
  void account.requestInhaVerification(inhaEmail.value);
};
root.querySelector<HTMLButtonElement>('[data-inha-confirm]')!.onclick = async () => {
  if (await account.confirmInhaVerification(inhaEmail.value, inhaCode.value)) inhaCode.value = '';
};
root.querySelector<HTMLButtonElement>('[data-account-sync]')!.onclick = () => { void account.syncNow(); };
const accountSignOut = root.querySelector<HTMLButtonElement>('[data-account-signout]')!;
accountSignOut.onclick = async () => {
  accountSignOut.disabled = true;
  try {
    if (await account.signOut()) {
      accountLoginPassword.value = '';
      accountNewPassword.value = '';
      accountNewPasswordConfirm.value = '';
    }
  } finally {
    accountSignOut.disabled = false;
  }
};
setAccountMode('signup');
void account.init();

interface BallEffect {
  bombArmed: boolean;
  bombPower: number;
  elasticMs: number;
  trail: { x: number; y: number }[];
  isClone: boolean;
  remainingMs: number;
}

class PilotGame {
  private world = createWorld();
  private paddle!: PaddleRuntime;
  private ball!: BallSystem;
  private bricks!: BrickField;
  private run = createRunState();
  private telemetry = new PilotTelemetry(mode, 0);
  private restartCount = 0;
  private launchAt = 0;
  private lastFrame = performance.now();
  private raf = 0;
  private collisionHandler?: (event: Matter.IEventCollision<Engine>) => void;
  private readonly effects = new Map<number, BallEffect>();
  private pendingClone: { ball: Body; fused: boolean }[] = [];
  private effectTimeMs = 0;
  private impact: { x: number; y: number; kind: 'elastic' | 'bomb' | 'clone'; ms: number } | null = null;
  private blast: { x: number; y: number; neighbors: { x: number; y: number }[]; ms: number } | null = null;
  private mergeBurst: { x: number; y: number; kind: Exclude<DuckKind, 'basic'>; ms: number } | null = null;
  private growth = new FeatherGrowth();
  private wave = 1;
  private waveCleared = false;
  private paddleTouchThisTick = false;
  private evolvedKind: Exclude<DuckKind, 'basic'> | undefined;
  private xpPopups: { x: number; y: number; label: string; ms: number }[] = [];

  private readonly input = new InputController(surface);
  private readonly renderer = new GameRenderer(canvas);
  private readonly hud = new Hud(root.querySelector<HTMLElement>('[data-hud]')!,
    () => this.restart(), () => this.togglePause(), (kind, index) => this.chooseEvolution(kind, index));
  private readonly onRestartKey = (event: KeyboardEvent) => {
    if (event.code !== 'KeyR' && event.key.toLowerCase() !== 'r' && event.key !== 'ㄱ') return;
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.run.phase !== 'LOST' && this.run.phase !== 'CLEAR') return;
    event.preventDefault();
    this.restart();
  };
  private readonly onPauseKey = (event: KeyboardEvent) => {
    if (event.code !== 'KeyP' && event.key.toLowerCase() !== 'p' && event.key !== 'ㅔ'
      && event.code !== 'Space') return;
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
    if (this.run.phase !== 'RUNNING' && this.run.phase !== 'PAUSED') return;
    event.preventDefault();
    this.togglePause();
  };

  constructor() {
    window.addEventListener('keydown', this.onRestartKey);
    window.addEventListener('keydown', this.onPauseKey);
    this.buildRun();
    this.loop(performance.now());
  }

  private buildRun(): void {
    this.detachCollisions();
    Engine.clear(this.world.engine);
    Composite.clear(this.world.engine.world, false, true);
    this.world = createWorld();
    this.run = createRunState();
    this.telemetry = new PilotTelemetry(mode, this.restartCount);
    this.growth = new FeatherGrowth();
    this.wave = 1;
    this.waveCleared = false;
    this.evolvedKind = undefined;
    this.hud.resetEvolution();
    this.effects.clear();
    this.pendingClone = [];
    this.effectTimeMs = 0;
    this.impact = null;
    this.blast = null;
    this.mergeBurst = null;
    this.xpPopups = [];
    this.input.reset();
    this.paddle = mode === 'living'
      ? new LivingPaddle(this.world.engine, 180, activeLayout,
        growthEnabled ? false : cloneEnabled, elasticMode)
      : new RigidPaddle(this.world.engine, 180);
    this.ball = new BallSystem(this.world.engine);
    this.effects.set(this.ball.body.id, this.newEffect(false));
    this.bricks = new BrickField(this.world.engine, brickPattern);
    this.attachCollisions();
    this.launchAt = performance.now() + (testMode ? 20 : tuning.ball.launchDelayMs);
    this.lastFrame = performance.now();
    root.dataset.phase = this.run.phase;
  }

  private newEffect(isClone: boolean, fused = false): BallEffect {
    return { bombArmed: false, bombPower: 1, elasticMs: 0, trail: [], isClone,
      remainingMs: isClone ? fused ? 9500 : 6500 : Infinity };
  }

  private attachCollisions(): void {
    const engine = this.world.engine;
    this.collisionHandler = (event) => {
      if (this.run.phase !== 'RUNNING') return;
      const paddleContacts: { ball: Body; other: Body; part: Body; index: number }[] = [];
      for (const pair of event.pairs) {
        const a = pair.bodyA.parent;
        const b = pair.bodyB.parent;
        const ball = a.label === 'ball' ? a : b.label === 'ball' ? b : null;
        if (!ball) continue;
        const other = ball === a ? b : a;
        const part = pair.bodyA.parent === other ? pair.bodyA
          : pair.bodyB.parent === other ? pair.bodyB : other;

        if (other.label === 'living-duck' || other.label === 'rigid-paddle') {
          paddleContacts.push({ ball, other, part, index: this.paddle.bodies.indexOf(other) });
        }
      }
      // Matter can report torso/head or two ducks in the same tick. Pick one
      // contact by distance to the torso, then index, regardless of pair order.
      paddleContacts.sort((a, b) => {
        const ta = a.other.parts[1] ?? a.other;
        const tb = b.other.parts[1] ?? b.other;
        const distance = (hit: typeof a, torso: Body) => Math.hypot(
          hit.ball.position.x - torso.position.x, hit.ball.position.y - torso.position.y);
        return distance(a, ta) - distance(b, tb) || a.index - b.index
          || Number(a.part.label === 'living-duck-head') - Number(b.part.label === 'living-duck-head');
      });
      const hits = new Map<number, (typeof paddleContacts)[number]>();
      for (const contact of paddleContacts) {
        if (!hits.has(contact.ball.id)) hits.set(contact.ball.id, contact);
      }
      if (hits.size) this.paddleTouchThisTick = true;
      for (const hit of hits.values()) {
        if (!this.ball.has(hit.ball)) continue;
        const kind = this.paddle instanceof LivingPaddle
          ? this.paddle.onBallHit(hit.ball, hit.part)
          : (this.paddle.onBallHit(hit.ball, hit.other), null);
        this.telemetry.recordPaddleHit(kind);
        const effect = this.effects.get(hit.ball.id)!;
        const fused = this.paddle instanceof LivingPaddle && this.paddle.fusionTiers[hit.index] === 2;
        effect.bombArmed = kind === 'bomb';
        effect.bombPower = fused ? 2 : 1;
        effect.elasticMs = kind === 'elastic' ? fused ? 750 : 500 : 0;
        effect.trail.length = 0;
        if (kind === 'clone' && (cloneEnabled || growthEnabled))
          this.pendingClone.push({ ball: hit.ball, fused });
        this.impact = kind === 'elastic' || kind === 'bomb' || kind === 'clone'
          ? { x: hit.other.position.x, y: hit.other.position.y, kind, ms: 290 } : null;
      }

      const lost = new Set<Body>();
      for (const pair of event.pairs) {
        const a = pair.bodyA.parent;
        const b = pair.bodyB.parent;
        const ball = a.label === 'ball' ? a : b.label === 'ball' ? b : null;
        if (!ball || !this.ball.has(ball)) continue;
        const other = ball === a ? b : a;
        if (other.label === 'brick') {
          const hit = this.bricks.hitBrick(other);
          if (hit === 'none') continue;
          if (hit === 'damaged') { this.telemetry.recordBrickHit(false); continue; }
          this.telemetry.recordBrickHit(true);
          if (growthEnabled) this.awardBrickXp(other);
          const effect = this.effects.get(ball.id)!;
          if (effect.bombArmed) {
            effect.bombArmed = false;
            effect.trail.length = 0;
            const neighbors: { x: number; y: number }[] = [];
            for (let i = 0; i < effect.bombPower; i++) {
              const neighbor = this.bricks.destroyAdjacentBrick(other);
              if (!neighbor) break;
              this.telemetry.recordAdditionalBrickDestroyed();
              if (growthEnabled) this.awardBrickXp(neighbor);
              neighbors.push({ x: neighbor.position.x, y: neighbor.position.y });
            }
            this.blast = { x: other.position.x, y: other.position.y, neighbors, ms: 370 };
          }
          if (this.bricks.remainingCount === 0) {
            if (growthEnabled) this.waveCleared = true;
            else this.finish('CLEAR');
          }
        } else if (other.label === 'lose-sensor' && !hits.has(ball.id)) {
          lost.add(ball);
        }
      }
      if (this.run.phase !== 'RUNNING') return;
      for (const ball of lost) this.removeBall(ball);
      if (this.ball.bodies.length === 0) this.finish('LOST');
    };
    Events.on(engine, 'collisionStart', this.collisionHandler);
  }

  private awardBrickXp(brick: Body): void {
    const before = this.growth.xp;
    this.growth.brickBroken(brick.position.x, brick.position.y);
    if (this.growth.xp > before) this.xpPopups.push({ x: brick.position.x,
      y: brick.position.y, label: `+${this.growth.xp - before} XP`, ms: 850 });
    this.announceLevelUp(before);
  }

  private announceLevelUp(before: number): void {
    if (before >= this.growth.targetXp || !this.growth.pending) return;
    const center = this.paddle.bodies[2];
    this.xpPopups.push({ x: center.position.x, y: center.position.y - 66,
      label: `LV.${this.growth.level} 진화 가능!`, ms: 1250 });
  }

  private removeBall(body: Body): void {
    this.ball.remove(body);
    this.effects.delete(body.id);
    this.pendingClone = this.pendingClone.filter(candidate => candidate.ball !== body);
  }

  private detachCollisions(): void {
    if (this.collisionHandler) {
      Events.off(this.world.engine, 'collisionStart', this.collisionHandler);
      this.collisionHandler = undefined;
    }
  }

  private openEvolution(now: number): void {
    if (!growthEnabled || this.run.phase !== 'RUNNING' || !this.growth.pending) return;
    this.run.transition('CHOOSING');
    this.telemetry.pause(now);
    this.input.reset(this.paddle.getCenterX());
    root.dataset.phase = this.run.phase;
  }

  chooseEvolution(kind: Exclude<DuckKind, 'basic'>, index: number): void {
    if (!growthEnabled || this.run.phase !== 'CHOOSING'
      || !(this.paddle instanceof LivingPaddle)) return;
    const source = this.growth.evolutions === 1 ? this.paddle.fuseAdjacentDuck(index, kind) : null;
    if (source === null && !this.paddle.evolveDuck(index, kind)) return;
    if (source !== null) {
      const duck = this.paddle.bodies[source];
      this.mergeBurst = { x: duck.position.x, y: duck.position.y - 23, kind, ms: 950 };
    }
    this.evolvedKind = kind;
    this.growth.evolve();
    this.hud.resetEvolution();
    if (this.waveCleared && this.wave === 1) this.startNextWave();
    if (this.run.phase === 'CHOOSING') this.run.transition('RUNNING');
    const now = performance.now();
    this.telemetry.resume(now);
    if (this.waveCleared && this.wave === 2) this.finish('CLEAR');
    this.input.reset(this.paddle.getCenterX());
    this.lastFrame = now;
    root.dataset.phase = this.run.phase;
  }

  private startNextWave(): void {
    this.bricks.destroy();
    this.bricks = new BrickField(this.world.engine,
      brickPattern === 'classic' ? 'clusters' : 'classic', true);
    this.growth.startSecondWave();
    this.wave = 2;
    this.waveCleared = false;
    this.pendingClone = [];
    this.ball.destroy();
    this.ball = new BallSystem(this.world.engine);
    this.ball.launch();
    this.effects.clear();
    this.effects.set(this.ball.body.id, this.newEffect(false));
    this.xpPopups = [];
    this.mergeBurst = null;
  }

  private finish(next: 'CLEAR' | 'LOST'): void {
    if (this.run.phase !== 'RUNNING') return;
    this.run.transition(next);
    this.telemetry.pause(performance.now());
    this.pendingClone = [];
    this.ball.bodies.forEach(body => Body.setVelocity(body, { x: 0, y: 0 }));
    root.dataset.phase = this.run.phase;
    account.recordRun({
      result: next,
      wave: this.wave,
      level: this.growth.level,
      evolutions: this.growth.evolutions,
      evolvedKind: this.evolvedKind ?? null,
    });
  }

  restart(): void {
    if (this.run.phase === 'CLEAR' || this.run.phase === 'LOST') {
      this.run.transition('READY');
      this.restartCount += 1;
      this.buildRun();
    }
  }

  private togglePause(): void {
    const now = performance.now();
    if (this.run.phase === 'RUNNING') {
      this.run.transition('PAUSED');
      this.telemetry.pause(now);
    } else if (this.run.phase === 'PAUSED') {
      this.run.transition('RUNNING');
      this.telemetry.resume(now);
      this.input.reset(this.paddle.getCenterX());
      this.lastFrame = now;
    } else return;
    root.dataset.phase = this.run.phase;
  }

  private loop = (now: number) => {
    const delta = Math.min(33.333, Math.max(8, now - this.lastFrame));
    this.lastFrame = now;
    const targetX = this.run.phase === 'PAUSED' || this.run.phase === 'CHOOSING'
      ? this.paddle.getCenterX() : this.input.update(now);

    if (this.run.phase === 'READY' && now >= this.launchAt) {
      this.run.transition('RUNNING');
      this.telemetry.start(now);
      this.ball.launch();
      root.dataset.phase = this.run.phase;
    }

    if (this.run.phase === 'RUNNING') {
      this.paddleTouchThisTick = false;
      this.effectTimeMs += delta;
      this.xpPopups = this.xpPopups.filter(popup => (popup.ms -= delta) > 0);
      for (const effect of this.effects.values()) effect.elasticMs = Math.max(0, effect.elasticMs - delta);
      if (this.impact) {
        this.impact.ms -= delta;
        if (this.impact.ms <= 0) this.impact = null;
      }
      if (this.blast) {
        this.blast.ms -= delta;
        if (this.blast.ms <= 0) this.blast = null;
      }
      if (this.mergeBurst) {
        this.mergeBurst.ms -= delta;
        if (this.mergeBurst.ms <= 0) this.mergeBurst = null;
      }
      this.paddle.update(targetX, delta);
      Engine.update(this.world.engine, delta);
      this.paddle.stabilize?.();
      if (this.run.phase === 'RUNNING') {
        if (growthEnabled) {
          const before = this.growth.xp;
          const caught = this.growth.update(delta, this.paddle.bodies);
          let gained = this.growth.xp - before;
          for (const index of caught) {
            const amount = Math.min(2, gained);
            if (!amount) break;
            gained -= amount;
            const duck = this.paddle.bodies[index];
            this.xpPopups.push({ x: duck.position.x, y: duck.position.y - 34,
              label: `+${amount} XP`, ms: 850 });
          }
          this.announceLevelUp(before);
        }
        for (const { ball, fused } of this.pendingClone) {
          const clone = this.ball.spawnClone(ball);
          if (clone) {
            this.effects.set(clone.id, this.newEffect(true, fused));
            this.telemetry.recordClone(this.ball.bodies.length);
          }
        }
        this.pendingClone = [];
        for (const body of this.ball.bodies) {
          const effect = this.effects.get(body.id)!;
          if (effect.isClone) {
            effect.remainingMs -= delta;
            if (effect.remainingMs <= 0) { this.removeBall(body); continue; }
          }
          const speed = this.ball.clampSpeed(body);
          if (effect.bombArmed || effect.elasticMs > 0 || effect.isClone) {
            effect.trail.push({ x: body.position.x, y: body.position.y });
            if (effect.trail.length > 7) effect.trail.shift();
          } else effect.trail.length = 0;
          this.telemetry.observeBallSpeed(speed);
        }
        if (this.ball.bodies.length === 0) this.finish('LOST');
        if (this.run.phase === 'RUNNING' && growthEnabled) {
          if (this.growth.pending && (this.paddleTouchThisTick ||
            (this.waveCleared && this.growth.empty))) this.openEvolution(now);
          else if (this.waveCleared && this.growth.empty && this.wave === 2) this.finish('CLEAR');
          else if (this.waveCleared && this.growth.empty && this.wave === 1) {
            if (!this.growth.evolved) this.growth.addXp(this.growth.targetXp - this.growth.xp);
            else this.startNextWave();
          }
        }
      }
      this.telemetry.observeFlex(this.paddle.getFlexPx());
    } else if (this.run.phase !== 'PAUSED' && this.run.phase !== 'CHOOSING') {
      this.paddle.update(targetX, delta);
      Engine.update(this.world.engine, delta);
      this.paddle.stabilize?.();
    }

    const snapshot = this.telemetry.snapshot(now);
    this.hud.update(mode, this.run.phase, this.bricks.remainingCount, snapshot,
      this.ball.bodies.length, growthEnabled ? {
        wave: this.wave, xp: this.growth.xp, target: this.growth.targetXp,
        level: this.growth.level, evolutions: this.growth.evolutions,
        falling: this.growth.feathers.length,
        duckKinds: this.paddle instanceof LivingPaddle ? this.paddle.kinds : [],
        fusionTiers: this.paddle instanceof LivingPaddle ? this.paddle.fusionTiers : [],
      } : undefined);
    this.renderer.render({
      balls: this.ball.bodies.map(body => ({ body, ...this.effects.get(body.id)! })),
      paddleBodies: this.paddle.bodies,
      paddleConstraints: this.paddle.constraints,
      bricks: this.bricks.bodies.filter((body) => Composite.get(this.world.engine.world, body.id, 'body') !== null),
      brickDurability: this.bricks.durability,
      xpPopups: this.xpPopups,
      feathers: growthEnabled ? this.growth.feathers : [],
      mode,
      phase: this.run.phase,
      targetX,
      showColliders: testMode,
      duckHitFlash: this.paddle instanceof LivingPaddle ? this.paddle.getHitFlash() : [],
      duckKinds: this.paddle instanceof LivingPaddle ? this.paddle.kinds : [],
      fusionTiers: this.paddle instanceof LivingPaddle ? this.paddle.fusionTiers : [],
      effectTimeMs: this.effectTimeMs,
      impact: this.impact,
      blast: this.blast,
      mergeBurst: this.mergeBurst,
    });

    if (testMode) {
      const debug: DebugSnapshot = {
        mode,
        phase: this.run.phase,
        ducks: mode === 'living' ? this.paddle.bodies.length : 0,
        bricksRemaining: this.bricks.remainingCount,
        telemetry: snapshot,
        duckPositions: mode === 'living' ? this.paddle.bodies.map(body => ({
          x: body.position.x, y: body.position.y, angle: body.angle, parts: body.parts.length,
        })) : [],
        ballPosition: this.ball.bodies[0] ? { x: this.ball.bodies[0].position.x,
          y: this.ball.bodies[0].position.y } : undefined,
        ballPositions: this.ball.bodies.map(body => ({ x: body.position.x, y: body.position.y })),
        ballVelocities: this.ball.bodies.map(body => ({ x: body.velocity.x, y: body.velocity.y })),
        brickPositions: this.bricks.bodies.filter(body =>
          Composite.get(this.world.engine.world, body.id, 'body') !== null)
          .map(body => ({ x: body.position.x, y: body.position.y })),
        reinforcedBricks: this.bricks.bodies.filter(body => this.bricks.durability.has(body.id))
          .map(body => ({ x: body.position.x, y: body.position.y,
            hp: this.bricks.durability.get(body.id)!.hp })),
        worldBodies: Composite.allBodies(this.world.engine.world).length,
        worldConstraints: Composite.allConstraints(this.world.engine.world).length,
        flockLayout: activeLayout,
        duckKinds: this.paddle instanceof LivingPaddle ? this.paddle.kinds : [],
        fusionTiers: this.paddle instanceof LivingPaddle ? [...this.paddle.fusionTiers] : [],
        mergeActive: this.mergeBurst !== null,
        bombArmed: this.ball.bodies.some(body => this.effects.get(body.id)?.bombArmed),
        ballEffect: this.ball.bodies.some(body => this.effects.get(body.id)?.bombArmed)
          ? 'bomb' : this.ball.bodies.some(body => (this.effects.get(body.id)?.elasticMs ?? 0) > 0)
            ? 'elastic' : 'none',
        blastActive: this.blast !== null,
        activeBalls: this.ball.bodies.length,
        cloneRemainingMs: [...this.effects.values()].find(effect => effect.isClone)?.remainingMs,
        elasticMode,
        brickPattern: this.bricks.pattern,
        cloneEnabled: cloneEnabled || (growthEnabled && this.evolvedKind === 'clone'),
        growthEnabled,
        wave: this.wave,
        xp: this.growth.xp,
        xpTarget: this.growth.targetXp,
        level: this.growth.level,
        evolutions: this.growth.evolutions,
        xpPopups: this.xpPopups.map(popup => popup.label),
        featherPositions: this.growth.feathers.map(item => ({ x: item.x, y: item.y })),
        evolutionPending: this.growth.pending,
        evolvedKind: this.evolvedKind,
      };
      (window as Window & { __QUACKTRIS__?: DebugSnapshot }).__QUACKTRIS__ = debug;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  forceLoseForTest(): void {
    if (testMode) this.finish('LOST');
  }

  setBallForTest(x: number, y: number, vx: number, vy: number, index = 0): void {
    if (!testMode || this.run.phase !== 'RUNNING') return;
    const body = this.ball.bodies[index];
    if (!body) return;
    Body.setPosition(body, { x, y });
    Body.setVelocity(body, { x: vx, y: vy });
  }

  grantXpForTest(count: number): void {
    if (!testMode || !growthEnabled || this.run.phase !== 'RUNNING') return;
    this.growth.addXp(count);
  }

  clearWaveForTest(): void {
    if (!testMode || !growthEnabled || this.run.phase !== 'RUNNING') return;
    this.bricks.bodies.forEach(body => this.bricks.destroyBrick(body));
    this.waveCleared = true;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.detachCollisions();
    this.input.destroy();
    this.hud.destroy();
    window.removeEventListener('keydown', this.onRestartKey);
    window.removeEventListener('keydown', this.onPauseKey);
    this.paddle.destroy(this.world.engine);
    this.ball.destroy();
    this.bricks.destroy();
    Engine.clear(this.world.engine);
  }
}

const game = new PilotGame();
if (testMode) {
  (window as Window & {
    __QUACKTRIS_TEST_API__?: { forceLose(): void; restart(): void;
      setBall(x: number, y: number, vx: number, vy: number, index?: number): void;
      grantXp(count: number): void; choose(kind: Exclude<DuckKind, 'basic'>, index: number): void;
      clearWave(): void };
  }).__QUACKTRIS_TEST_API__ = {
    forceLose: () => game.forceLoseForTest(),
    restart: () => game.restart(),
    setBall: (x, y, vx, vy, index) => game.setBallForTest(x, y, vx, vy, index),
    grantXp: count => game.grantXpForTest(count),
    choose: (kind, index) => game.chooseEvolution(kind, index),
    clearWave: () => game.clearWaveForTest(),
  };
}
window.addEventListener('pagehide', () => game.destroy(), { once: true });
