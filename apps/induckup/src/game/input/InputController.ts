import { LOGICAL_WIDTH, tuning } from '../config/tuning';

export function clampTargetX(x: number, padding = 20): number {
  return Math.max(padding, Math.min(LOGICAL_WIDTH - padding, x));
}

export class InputController {
  private targetX = LOGICAL_WIDTH / 2;
  private pointerActive = false;
  private left = false;
  private right = false;
  private lastUpdateMs = performance.now();

  constructor(private readonly surface: HTMLElement) {
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerUp);
    surface.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private pointerToLogicalX(clientX: number): number {
    const rect = this.surface.getBoundingClientRect();
    const normalized = (clientX - rect.left) / Math.max(1, rect.width);
    return clampTargetX(normalized * LOGICAL_WIDTH);
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest('button')) return;
    this.pointerActive = true;
    this.targetX = this.pointerToLogicalX(event.clientX);
    this.surface.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.pointerActive) return;
    this.targetX = this.pointerToLogicalX(event.clientX);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.pointerActive) return;
    this.pointerActive = false;
    this.targetX = this.pointerToLogicalX(event.clientX);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') this.left = true;
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') this.right = true;
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') this.left = false;
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') this.right = false;
  };

  update(nowMs: number): number {
    const deltaSeconds = Math.min(0.05, Math.max(0, (nowMs - this.lastUpdateMs) / 1000));
    this.lastUpdateMs = nowMs;
    const axis = Number(this.right) - Number(this.left);
    if (!this.pointerActive && axis !== 0) {
      this.targetX = clampTargetX(this.targetX + axis * tuning.paddle.maxTargetSpeed * deltaSeconds);
    }
    return this.targetX;
  }

  reset(x = LOGICAL_WIDTH / 2): void {
    this.targetX = clampTargetX(x);
    this.pointerActive = false;
    this.left = false;
    this.right = false;
    this.lastUpdateMs = performance.now();
  }

  destroy(): void {
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
