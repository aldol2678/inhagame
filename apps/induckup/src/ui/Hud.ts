import type { PilotMode, RunPhase, TelemetrySnapshot } from '../game/core/types';
import type { DuckKind } from '../game/paddle/duckTypes';
import { adjacentFusionSource } from '../game/paddle/duckFusion';

const evolutionKinds: Exclude<DuckKind, 'basic'>[] = ['elastic', 'bomb', 'clone'];

export class Hud {
  private readonly modeEl: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly growthLevelEl: HTMLElement;
  private readonly growthMeterEl: HTMLElement;
  private readonly growthFillEl: HTMLElement;
  private readonly pauseEl: HTMLButtonElement;
  private readonly pausePanelEl: HTMLElement;
  private readonly evolutionEl: HTMLElement;
  private selectedKind: Exclude<DuckKind, 'basic'> | null = null;
  private readonly onEvolutionKey = (event: KeyboardEvent) => {
    if (this.evolutionEl.hidden || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
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
      this.onEvolve?.(this.selectedKind, Number(slot) - 1);
    }
  };

  constructor(root: HTMLElement, onRestart: () => void, onPause: () => void,
    private readonly onEvolve?: (kind: Exclude<DuckKind, 'basic'>, index: number) => void) {
    root.innerHTML = `
      <div class="hud-main">
        <div>
          <strong>인덕업</strong>
          <span class="pilot-badge">PILOT</span>
        </div>
        <strong class="growth-level" data-ui="growth-level" hidden></strong>
        <div class="mode" data-ui="mode"></div>
      </div>
      <div class="hud-sub">
        <span data-ui="phase"></span>
        <span data-ui="stats"></span>
        <button type="button" class="pause-button" data-ui="pause" aria-label="일시정지" hidden>Ⅱ</button>
      </div>
      <div class="growth-meter" data-ui="growth-meter" role="progressbar" aria-label="진화 경험치" hidden>
        <span data-ui="growth-fill"></span>
      </div>
      <div class="result-panel pause-panel" data-ui="pause-panel" hidden>
        <strong>일시정지</strong>
        <p>준비되면 이어서 플레이하세요.</p>
        <button type="button" data-ui="resume">계속하기</button>
      </div>
      <div class="result-panel evolution-panel" data-ui="evolution" hidden>
        <strong>첫 진화!</strong>
        <p>능력을 고르고 진화할 오리를 선택하세요</p>
        <div class="evolution-kinds" aria-label="진화 능력">
          <button type="button" data-kind="elastic">탄성</button>
          <button type="button" data-kind="bomb">폭탄</button>
          <button type="button" data-kind="clone">복제</button>
        </div>
        <div class="evolution-slots" aria-label="진화할 오리">
          <button type="button" data-slot="0">1</button><button type="button" data-slot="1">2</button>
          <button type="button" data-slot="2">3</button><button type="button" data-slot="3">4</button>
          <button type="button" data-slot="4">5</button>
        </div>
        <small>왼쪽부터 오리 1~5번 · PC: 방향키로 능력, 숫자키로 오리 선택</small>
      </div>
      <div class="result-panel" data-ui="result" hidden>
        <div class="result-copy"></div>
        <button type="button" data-ui="restart">다시 꽥 <span class="restart-key">R</span></button>
      </div>`;
    this.modeEl = root.querySelector('[data-ui="mode"]') as HTMLElement;
    this.growthLevelEl = root.querySelector('[data-ui="growth-level"]') as HTMLElement;
    this.growthMeterEl = root.querySelector('[data-ui="growth-meter"]') as HTMLElement;
    this.growthFillEl = root.querySelector('[data-ui="growth-fill"]') as HTMLElement;
    this.phaseEl = root.querySelector('[data-ui="phase"]') as HTMLElement;
    this.statsEl = root.querySelector('[data-ui="stats"]') as HTMLElement;
    this.resultEl = root.querySelector('[data-ui="result"]') as HTMLElement;
    this.pauseEl = root.querySelector('[data-ui="pause"]') as HTMLButtonElement;
    this.pausePanelEl = root.querySelector('[data-ui="pause-panel"]') as HTMLElement;
    this.evolutionEl = root.querySelector('[data-ui="evolution"]') as HTMLElement;
    this.pauseEl.addEventListener('click', onPause);
    (root.querySelector('[data-ui="resume"]') as HTMLButtonElement).addEventListener('click', onPause);
    (root.querySelector('[data-ui="restart"]') as HTMLButtonElement).addEventListener('click', onRestart);
    this.evolutionEl.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button =>
      button.addEventListener('click', () => this.selectKind(button.dataset.kind as Exclude<DuckKind, 'basic'>)));
    this.evolutionEl.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button =>
      button.addEventListener('click', () => {
        if (this.selectedKind && !this.evolutionEl.hidden) this.onEvolve?.(this.selectedKind, Number(button.dataset.slot));
      }));
    window.addEventListener('keydown', this.onEvolutionKey);
  }

  selectKind(kind: Exclude<DuckKind, 'basic'>): void {
    if (this.evolutionEl.hidden) return;
    this.selectedKind = kind;
    this.evolutionEl.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.kind === kind)));
    this.evolutionEl.querySelector<HTMLButtonElement>('[data-slot]:not(:disabled)')?.focus();
  }

  resetEvolution(): void {
    this.selectedKind = null;
    this.evolutionEl.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button =>
      button.setAttribute('aria-pressed', 'false'));
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onEvolutionKey);
  }

  update(mode: PilotMode, phase: RunPhase, bricks: number, telemetry: TelemetrySnapshot,
    activeBalls = 1, growth?: { wave: number; level: number; xp: number; target: number;
      evolutions: number; falling: number; duckKinds: readonly DuckKind[];
      fusionTiers: readonly number[] }): void {
    this.modeEl.textContent = growth ? 'DUCK GROWTH · TEST'
      : mode === 'living' ? 'LIVING PADDLE' : 'RIGID BASELINE · TEST';
    this.growthLevelEl.hidden = this.growthMeterEl.hidden = !growth;
    if (growth) {
      this.growthLevelEl.textContent = `LV.${growth.level} · XP ${growth.xp}/${growth.target}`;
      this.growthMeterEl.setAttribute('aria-valuenow', String(growth.xp));
      this.growthMeterEl.setAttribute('aria-valuemax', String(growth.target));
      this.growthFillEl.style.width = `${Math.min(100, growth.xp / growth.target * 100)}%`;
    }
    this.phaseEl.textContent = phase;
    this.statsEl.textContent = growth
      ? `${growth.wave}/2 · ${growth.evolutions === 2 ? '진화 완료' : `깃털 낙하 ${growth.falling}`} · 벽돌 ${bricks} · 공 ${activeBalls}`
      : `벽돌 ${bricks} · 공 ${activeBalls} · 반사 ${telemetry.paddleHits}`;

    this.pauseEl.hidden = phase !== 'RUNNING';
    this.pausePanelEl.hidden = phase !== 'PAUSED';
    const wasHidden = this.evolutionEl.hidden;
    this.evolutionEl.hidden = phase !== 'CHOOSING';
    if (growth && phase === 'CHOOSING') {
      (this.evolutionEl.querySelector('strong') as HTMLElement).textContent =
        growth.evolutions ? '두 번째 진화!' : '첫 진화!';
      this.evolutionEl.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((button, index) => {
        button.disabled = growth.duckKinds[index] !== 'basic';
        button.title = button.disabled ? '이미 진화한 오리' : '';
        const source = growth.evolutions === 1 && this.selectedKind
          ? adjacentFusionSource(growth.duckKinds, index, this.selectedKind) : null;
        button.dataset.fusion = String(source !== null && growth.fusionTiers[source] === 1);
      });
      (this.evolutionEl.querySelector('small') as HTMLElement).textContent = growth.evolutions
        ? '같은 능력의 인접 오리를 고르면 5→4마리 합체! · PC: 방향키로 능력, 숫자키로 오리 선택'
        : '왼쪽부터 오리 1~5번 · PC: 방향키로 능력, 숫자키로 오리 선택';
    }
    if (wasHidden && phase === 'CHOOSING') this.evolutionEl.querySelector<HTMLButtonElement>('[data-kind]')?.focus();

    const done = phase === 'CLEAR' || phase === 'LOST';
    this.resultEl.hidden = !done;
    if (done) {
      const copy = this.resultEl.querySelector('.result-copy') as HTMLElement;
      const { basic, elastic, bomb, clone } = telemetry.hitsByDuckKind;
      copy.innerHTML = `<strong>${phase === 'CLEAR' ? 'CLEAR' : 'LOST'}</strong>
        <p>시간 ${(telemetry.elapsedMs / 1000).toFixed(1)}초 · 벽돌 ${telemetry.bricksDestroyed}</p>
        <p>오리별 반사 · 기본 ${basic} / 탄성 ${elastic} / 폭탄 ${bomb} / 복제 ${clone}</p>
        <p>폭탄 추가 파괴 ${telemetry.bombBonusBricks} · 실제 복제 ${telemetry.cloneTriggers}회</p>
        <p>최대 휘어짐 ${telemetry.maxFlexPx}px</p>`;
    }
  }
}
