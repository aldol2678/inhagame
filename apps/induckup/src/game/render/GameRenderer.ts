import type { Body, Constraint } from 'matter-js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, tuning } from '../config/tuning';
import type { PilotMode, RunPhase } from '../core/types';
import type { DuckKind } from '../paddle/duckTypes';
import type { Feather } from '../growth/FeatherGrowth';
import type { BrickDurability } from '../bricks/BrickField';
import type { LakeMonsterView } from '../../p4/MonsterField';
import type { CosmeticId } from '../../home/equipment';

export interface RenderFrame {
  balls: readonly { body: Body; bombArmed: boolean; elasticMs: number; pierceRemaining?: number;
    trail: readonly { x: number; y: number }[]; isClone: boolean; remainingMs: number }[];
  paddleBodies: Body[];
  paddleConstraints: Constraint[];
  bricks: Body[];
  brickDurability?: ReadonlyMap<number, BrickDurability>;
  monsters?: readonly LakeMonsterView[];
  obstacles?: readonly Body[];
  stageZones?: readonly string[];
  landingX?: number | null;
  cosmeticId?: CosmeticId | null;
  dangerLineY?: number;
  xpPopups?: readonly { x: number; y: number; label: string; ms: number }[];
  feathers?: readonly Feather[];
  mode: PilotMode;
  phase: RunPhase;
  targetX: number;
  showColliders: boolean;
  duckHitFlash: readonly number[];
  duckKinds: readonly DuckKind[];
  fusionTiers?: readonly number[];
  effectTimeMs: number;
  impact: { x: number; y: number; kind: 'elastic' | 'pierce' | 'bomb' | 'clone'; ms: number } | null;
  blast: { x: number; y: number; neighbors: { x: number; y: number }[]; ms: number } | null;
  mergeBurst?: { x: number; y: number; kind: Exclude<DuckKind, 'basic'>; ms: number } | null;
}

export class GameRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly duckSprites: Record<DuckKind, HTMLCanvasElement>;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = LOGICAL_WIDTH * dpr;
    canvas.height = LOGICAL_HEIGHT * dpr;
    ctx.scale(dpr, dpr);
    this.duckSprites = {
      basic: this.createDuckSprite('basic'),
      elastic: this.createDuckSprite('elastic'),
      pierce: this.createDuckSprite('pierce'),
      bomb: this.createDuckSprite('bomb'),
      clone: this.createDuckSprite('clone'),
    };
  }

  // One logical pixel is a 2px tile. Drawing the duck once on a small canvas
  // keeps its outline crisp while the compound physics body moves and rotates.
  private createDuckSprite(kind: DuckKind): HTMLCanvasElement {
    const sprite = document.createElement('canvas');
    const pixel = 2;
    const originX = 30, originY = 28;
    sprite.width = 64;
    sprite.height = 56;
    const ctx = sprite.getContext('2d');
    if (!ctx) throw new Error('2D duck sprite context unavailable');
    const width = sprite.width / pixel, height = sprite.height / pixel;
    const silhouette = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
    const within = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
      ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const x = col * pixel - originX + pixel / 2;
        const y = row * pixel - originY + pixel / 2;
        // The compound collider uses a 23×14 torso and a radius-10 head
        // centered at (16, -11). Leave one pixel for the dark outline.
        const body = within(x, y, 0, 0, 21, 13);
        const head = within(x, y, 16, -12, 10, 11);
        const neck = x >= 10 && x <= 20 && y >= -13 && y <= 0;
        const tail = x >= -22 && x <= -16 && y >= -7 && y <= (x + 22) * 0.5 - 2;
        silhouette[row][col] = body || head || neck || tail;
      }
    }

    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (!silhouette[row][col]) continue;
        const edge = !silhouette[row - 1]?.[col] || !silhouette[row + 1]?.[col]
          || !silhouette[row][col - 1] || !silhouette[row][col + 1];
        const palette = kind === 'elastic' ? ['#315f66', '#75bfc4', '#a9d9d5']
          : kind === 'pierce' ? ['#374b6a', '#6d91c8', '#b5d0f0']
          : kind === 'bomb' ? ['#79442a', '#e7964d', '#ffd07a']
            : kind === 'clone' ? ['#51446f', '#aa93d2', '#dbcaf1']
            : ['#654522', '#f4bd4d', '#ffd665'];
        ctx.fillStyle = edge ? palette[0] : row * pixel - originY > 5 ? palette[1] : palette[2];
        ctx.fillRect(col * pixel, row * pixel, pixel, pixel);
      }
    }

    const block = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(originX + x, originY + y, w, h);
    };
    // Beak and feet are render-only; only the torso and head collide with the ball.
    block(22, -12, 4, 2, '#654522');
    block(24, -10, 6, 4, '#654522');
    block(24, -10, 4, 2, '#f18c2e');
    block(16, -17, 2, 2, '#382b20');
    block(-10, 0, 2, 4, '#e8ab40');
    block(-8, 4, 8, 2, '#e8ab40');
    for (const x of [-10, 6]) {
      block(x, 10, 8, 8, '#654522');
      block(x + 2, 12, 6, 4, '#ed8730');
    }
    // A small wing mark remains legible when five ducks overlap near a wall.
    if (kind === 'elastic') {
      block(-9, -5, 8, 2, '#315f66');
      block(-5, -7, 4, 2, '#315f66');
      block(-5, -3, 4, 2, '#315f66');
    } else if (kind === 'pierce') {
      block(-11, -5, 13, 3, '#374b6a');
      block(-3, -8, 3, 9, '#e9f4ff');
      block(1, -6, 5, 5, '#374b6a');
    } else if (kind === 'bomb') {
      block(-9, -6, 8, 6, '#79442a');
      block(-7, -4, 4, 2, '#fff2c4');
      block(-5, -9, 2, 3, '#fff2c4');
    } else if (kind === 'clone') {
      block(-10, -7, 8, 8, '#51446f');
      block(-8, -5, 4, 4, '#f7f0ff');
      block(-1, -8, 2, 10, '#51446f');
    }
    return sprite;
  }

  render(frame: RenderFrame): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    ctx.fillStyle = '#f7f6f0';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    ctx.fillStyle = '#ece9df';
    ctx.fillRect(0, 48, LOGICAL_WIDTH, LOGICAL_HEIGHT - 48);
    if (frame.stageZones?.some(zone => zone === '후문 길목' || zone === '야간 추격'
      || zone === '후문 앞' || zone === '교문 앞')) {
      ctx.fillStyle = '#e0dfea';
      ctx.fillRect(0, 48, LOGICAL_WIDTH, LOGICAL_HEIGHT - 48);
      ctx.fillStyle = '#cbc9d9';
      ctx.fillRect(0, 48, LOGICAL_WIDTH, 8);
    }

    if (frame.stageZones) {
      ctx.save();
      ctx.fillStyle = '#5e6378';
      ctx.font = '700 11px system-ui';
      ctx.textAlign = 'center';
      frame.stageZones.forEach((name, index) => ctx.fillText(name, index ? 272 : 88, 76));
      ctx.restore();
    }

    this.drawBricks(frame.bricks, frame.brickDurability);
    this.drawObstacles(frame.obstacles ?? []);
    if (frame.dangerLineY !== undefined) this.drawDangerLine(frame.dangerLineY);
    this.drawMonsters(frame.monsters ?? []);
    this.drawFeathers(frame.feathers ?? []);
    if (frame.mode === 'living') this.drawLivingPaddle(frame.paddleBodies, frame.paddleConstraints,
      frame.showColliders, frame.duckHitFlash, frame.duckKinds, frame.fusionTiers ?? [], frame.cosmeticId);
    else this.drawRigidPaddle(frame.paddleBodies[0]);
    frame.balls.forEach(ball => this.drawBallTrail(ball));
    frame.balls.forEach(ball => this.drawBall(ball, frame.effectTimeMs));
    if (frame.landingX !== null && frame.landingX !== undefined) {
      ctx.save();
      ctx.fillStyle = '#265a73';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(frame.landingX, 498);
      ctx.lineTo(frame.landingX - 7, 483);
      ctx.lineTo(frame.landingX + 7, 483);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (frame.impact) this.drawImpact(frame.impact);
    if (frame.blast) this.drawBlast(frame.blast);
    if (frame.mergeBurst) this.drawMergeBurst(frame.mergeBurst);
    this.drawXpPopups(frame.xpPopups ?? []);

    if (frame.phase === 'READY') this.drawOverlay(frame.phase);
  }

  private drawDangerLine(y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#d98b35';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(LOGICAL_WIDTH - 12, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7b582c';
    ctx.font = '800 10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('위험선', LOGICAL_WIDTH - 14, y - 6);
    ctx.restore();
  }

  private drawObstacles(obstacles: readonly Body[]): void {
    for (const body of obstacles) {
      const x = body.position.x, y = body.position.y;
      if (body.label === 'stage-bookshelf') {
        const height = body.bounds.max.y - body.bounds.min.y;
        this.ctx.fillStyle = '#493d39';
        this.ctx.fillRect(x - 15, y - height / 2 - 3, 30, height + 6);
        this.ctx.fillStyle = '#a57b51';
        this.ctx.fillRect(x - 12, y - height / 2, 24, height);
        for (let shelf = -height / 2 + 8; shelf < height / 2 - 8; shelf += 15) {
          this.ctx.fillStyle = '#ded1a9';
          this.ctx.fillRect(x - 9, y + shelf, 18, 10);
          this.ctx.fillStyle = '#6d7f8b';
          this.ctx.fillRect(x - 6, y + shelf + 2, 3, 8);
          this.ctx.fillStyle = '#ad6762';
          this.ctx.fillRect(x + 1, y + shelf + 2, 4, 8);
        }
        continue;
      }
      if (body.label === 'stage-crossroad') {
        const height = body.bounds.max.y - body.bounds.min.y;
        this.ctx.fillStyle = '#5a5668';
        this.ctx.fillRect(x - 11, y - height / 2, 22, height);
        this.ctx.fillStyle = '#c8c2d4';
        for (let offset = -height / 2 + 12; offset < height / 2; offset += 24) {
          this.ctx.fillRect(x - 6, y + offset, 12, 4);
        }
        this.ctx.fillStyle = '#555878';
        this.ctx.font = '700 12px system-ui';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('↔', x, y + height / 2 + 28);
        continue;
      }
      if (body.label === 'stage-anniversary') {
        const height = body.bounds.max.y - body.bounds.min.y;
        const width = body.bounds.max.x - body.bounds.min.x;
        this.ctx.fillStyle = '#705b78';
        this.ctx.fillRect(x - width / 2, y - height / 2, width, height);
        this.ctx.fillStyle = '#e8cfab';
        this.ctx.fillRect(x - width / 2 + 2, y - height / 2 + 5, width - 4, 5);
        continue;
      }
      if (body.label === 'stage-backgate-lamp') {
        const height = body.bounds.max.y - body.bounds.min.y;
        this.ctx.fillStyle = '#424457';
        this.ctx.fillRect(x - 7, y - height / 2, 14, height);
        this.ctx.fillStyle = '#ffdc8d';
        this.ctx.fillRect(x - 10, y - height / 2 - 8, 20, 8);
        continue;
      }
      this.ctx.fillStyle = '#5a6270';
      this.ctx.fillRect(x - 13, y - 44, 26, 88);
      this.ctx.fillStyle = '#c8bca3';
      this.ctx.fillRect(x - 11, y - 40, 22, 80);
      this.ctx.fillStyle = '#f2dec0';
      this.ctx.fillRect(x - 7, y - 36, 4, 72);
    }
  }

  private drawMonsters(monsters: readonly LakeMonsterView[]): void {
    const ctx = this.ctx;
    monsters.forEach(({ body, kind, hp, maxHp, defense, warning, frozen, commandAura,
      finalPhase, weakSpotX }) => {
      const x = Math.round(body.position.x);
      const y = Math.round(body.position.y);
      if (commandAura) {
        ctx.save();
        ctx.strokeStyle = '#ae76d8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 70, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      const rapid = kind === 'rapid' || kind === 'rush' || kind === 'surge';
      const team = kind === 'team-doc' || kind === 'team-contact' || kind === 'team-slide';
      const boss = kind === 'boss' || kind === 'thesis' || kind === 'elite-giant'
        || kind === 'final-thesis';
      const radius = boss ? 1.5 : team ? 1.15 : kind === 'fragment' ? 0.75 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(radius, radius);
      ctx.fillStyle = '#3c4d4d';
      ctx.fillRect(-13, -11, 26, 22);
      ctx.fillRect(-9, -15, 18, 30);
      ctx.fillStyle = kind === 'final-thesis' ? '#543b79'
        : kind === 'final-shield' ? '#d9c6a2' : kind === 'elite-command' ? '#aa78cd'
        : kind === 'elite-giant' ? '#a76573' : kind === 'team-contact' ? '#75649e'
        : kind === 'team-doc' ? '#518b9c' : kind === 'team-slide' ? '#ae8060'
          : kind === 'splitter' ? '#9c7cbb' : kind === 'fragment' ? '#c6adce'
            : kind === 'flank' ? '#539c94' : kind === 'surge' ? '#e57559'
              : kind === 'thesis' ? '#765483' : kind === 'boss' ? '#8b6585'
        : kind === 'shield' ? '#617eaa' : kind === 'shelf' ? '#a68258'
          : kind === 'support' ? '#9e75a3'
        : kind === 'armor' || kind === 'guard' ? '#8b9ba9'
          : kind === 'swarm' ? '#a3b97d' : rapid ? '#ef8c55' : '#73b7bd';
      ctx.fillRect(-11, -9, 22, 18);
      ctx.fillRect(-7, -13, 14, 26);
      ctx.fillStyle = '#f7f6f0';
      ctx.fillRect(-6, -5, 4, 4);
      ctx.fillRect(3, -5, 4, 4);
      ctx.fillStyle = '#2b3637';
      ctx.fillRect(-5, -4, 2, 2);
      ctx.fillRect(4, -4, 2, 2);
      if (rapid) {
        ctx.fillStyle = '#fff1bc';
        ctx.fillRect(-14, 9, 6, 3);
        ctx.fillRect(8, 9, 6, 3);
      }
      if (kind === 'shield' || kind === 'thesis') {
        ctx.fillStyle = '#dce4ee';
        ctx.fillRect(-10, 12, 20, 3);
        ctx.fillStyle = '#57749b';
        ctx.fillRect(-7, 12, 14, 2);
      }
      if (kind === 'support') {
        ctx.fillStyle = '#f0cf78';
        ctx.fillRect(-3, 11, 6, 3);
      }
      if (kind === 'thesis') {
        ctx.fillStyle = '#443a59';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('마감논문', 0, -27);
      }
      if (kind === 'final-thesis') {
        ctx.fillStyle = '#352b50';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('졸업논문', 0, -28);
        ctx.fillText(`PHASE ${finalPhase}/5`, 0, -39);
        if (weakSpotX !== undefined) {
          ctx.strokeStyle = '#ffe08c';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc((weakSpotX - body.position.x) / radius, 0, 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (kind === 'final-shield') {
        ctx.fillStyle = '#413950';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('방어막', 0, -27);
      }
      if (team) {
        ctx.fillStyle = '#34344c';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(kind === 'team-doc' ? '자료' : kind === 'team-slide' ? '발표' : '연락', 0, -28);
        if (kind === 'team-contact') ctx.fillText('조별과제', 0, -40);
      }
      if (kind === 'elite-command' || kind === 'elite-giant') {
        ctx.fillStyle = '#472d54';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(kind === 'elite-command' ? 'ELITE 지휘' : 'ELITE 거대', 0, -31);
      }
      if (frozen) {
        ctx.strokeStyle = '#72cff2';
        ctx.lineWidth = 3;
        ctx.strokeRect(-14, -16, 28, 32);
      }
      if (warning) {
        ctx.strokeStyle = '#e65b46';
        ctx.lineWidth = 2;
        ctx.strokeRect(-17, -19, 34, 37);
        ctx.fillStyle = '#c44738';
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(kind === 'flank' ? x < 180 ? '→' : '←' : '!', 0,
          kind === 'final-thesis' ? -52 : team ? -52 : -29);
      }
      if (defense > 0) {
        ctx.fillStyle = '#e6e8ee';
        ctx.fillRect(-11, 10, 22, 3);
        ctx.fillStyle = '#4c5966';
        ctx.fillRect(-Math.min(10, defense), 10, Math.min(20, defense * 2), 3);
      }
      const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
      ctx.fillStyle = '#2f3334';
      ctx.fillRect(-15, -22, 30, 4);
      ctx.fillStyle = ratio > 0.5 ? '#62a96b' : ratio > 0.25 ? '#d6a13d' : '#d25e52';
      ctx.fillRect(-14, -21, Math.round(28 * ratio), 2);
      ctx.restore();
    });
  }

  private drawFeathers(feathers: readonly Feather[]): void {
    const ctx = this.ctx;
    for (const feather of feathers) {
      const x = Math.round(feather.x), y = Math.round(feather.y);
      // Keep pickups legible when the canvas is scaled to a narrow phone screen.
      ctx.fillStyle = '#fff8dd';
      ctx.fillRect(x - 6, y - 13, 14, 4);
      ctx.fillRect(x - 10, y - 9, 20, 16);
      ctx.fillRect(x - 8, y + 7, 15, 5);
      ctx.fillStyle = '#554125';
      ctx.fillRect(x - 5, y - 11, 9, 4);
      ctx.fillRect(x - 7, y - 7, 13, 8);
      ctx.fillRect(x - 6, y + 1, 10, 5);
      ctx.fillRect(x - 3, y + 6, 6, 4);
      ctx.fillStyle = '#e99f20';
      ctx.fillRect(x - 4, y - 10, 7, 4);
      ctx.fillRect(x - 6, y - 6, 11, 7);
      ctx.fillRect(x - 5, y + 1, 8, 5);
      ctx.fillRect(x - 2, y + 6, 4, 3);
      ctx.fillStyle = '#f8d14a';
      ctx.fillRect(x - 3, y - 9, 5, 4);
      ctx.fillRect(x - 5, y - 5, 9, 9);
      ctx.fillRect(x - 3, y + 4, 5, 3);
      ctx.fillStyle = '#fff4b1';
      ctx.fillRect(x - 3, y - 8, 4, 5);
      ctx.fillRect(x - 4, y - 3, 5, 3);
      ctx.fillStyle = '#875e28';
      ctx.fillRect(x + 1, y + 2, 2, 11);
      ctx.fillStyle = '#c77f19';
      ctx.fillRect(x - 10, y - 16, 3, 3);
      ctx.fillRect(x + 9, y + 10, 3, 3);
    }
  }

  private drawXpPopups(popups: readonly { x: number; y: number; label: string; ms: number }[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 14px system-ui';
    for (const popup of popups) {
      ctx.globalAlpha = Math.min(1, popup.ms / 180);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#352b25';
      ctx.fillStyle = '#ffdc77';
      const y = popup.y - (850 - popup.ms) * 0.035;
      ctx.strokeText(popup.label, popup.x, y);
      ctx.fillText(popup.label, popup.x, y);
    }
    ctx.restore();
  }

  private drawBricks(bricks: Body[], durability?: ReadonlyMap<number, BrickDurability>): void {
    const ctx = this.ctx;
    bricks.forEach((brick, index) => {
      const width = brick.bounds.max.x - brick.bounds.min.x;
      const height = brick.bounds.max.y - brick.bounds.min.y;
      const x = Math.round(brick.bounds.min.x + 1);
      const y = Math.round(brick.bounds.min.y + 1);
      const w = Math.floor(width - 2);
      const h = Math.floor(height - 2);
      const palette = [
        ['#d9c9a6', '#f0dfb7'],
        ['#beced0', '#e0ebdf'],
        ['#d5c6d9', '#ede1ee'],
      ][index % 3];
      const armor = durability?.get(brick.id);
      // Flat 2px steps echo the duck tiles, with the existing collision box untouched.
      ctx.fillStyle = '#463b34';
      ctx.fillRect(x + 2, y, w - 4, h);
      ctx.fillRect(x, y + 2, w, h - 4);
      ctx.fillStyle = armor ? armor.hp === 2 ? '#657585' : '#988899' : palette[0];
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.fillStyle = armor ? armor.hp === 2 ? '#b9d4dc' : '#d8bad4' : palette[1];
      ctx.fillRect(x + 4, y + 4, w - 8, 3);
      if (armor) {
        ctx.fillStyle = '#303d48';
        ctx.fillRect(x + 4, y + 10, 5, 3);
        ctx.fillRect(x + w - 9, y + 10, 5, 3);
        ctx.font = '800 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(armor.hp === 2 ? 'Ⅱ' : 'Ⅰ', x + w / 2, y + 16);
      }
      ctx.fillStyle = '#937e70';
      ctx.fillRect(x + w - 7, y + h - 6, 3, 2);
    });
  }

  private drawLivingPaddle(bodies: Body[], constraints: Constraint[], showColliders: boolean,
    hitFlash: readonly number[], kinds: readonly DuckKind[], tiers: readonly number[],
    cosmeticId?: CosmeticId | null): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#be8d3c';
    ctx.lineWidth = 3;
    ctx.lineCap = 'butt';
    constraints.forEach((constraint) => {
      const a = constraint.bodyA, b = constraint.bodyB;
      if (!a || !b || !constraint.pointA || !constraint.pointB) return;
      const ax = a.position.x + Math.cos(a.angle) * constraint.pointA.x - Math.sin(a.angle) * constraint.pointA.y;
      const ay = a.position.y + Math.sin(a.angle) * constraint.pointA.x + Math.cos(a.angle) * constraint.pointA.y;
      const bx = b.position.x + Math.cos(b.angle) * constraint.pointB.x - Math.sin(b.angle) * constraint.pointB.y;
      const by = b.position.y + Math.sin(b.angle) * constraint.pointB.x + Math.cos(b.angle) * constraint.pointB.y;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    });

    bodies.forEach((duck, index) => {
      ctx.save();
      ctx.translate(duck.position.x, duck.position.y);
      ctx.rotate(duck.angle);
      const torso = duck.parts[1];
      const dx = torso.position.x - duck.position.x, dy = torso.position.y - duck.position.y;
      const localX = dx * Math.cos(duck.angle) + dy * Math.sin(duck.angle);
      const localY = -dx * Math.sin(duck.angle) + dy * Math.cos(duck.angle);
      ctx.imageSmoothingEnabled = false;
      if (tiers[index] === 2) {
        ctx.save();
        ctx.translate(localX, localY);
        ctx.scale(1.35, 1.12);
        ctx.drawImage(this.duckSprites[kinds[index] ?? 'basic'], -30, -28);
        ctx.restore();
      } else ctx.drawImage(this.duckSprites[kinds[index] ?? 'basic'], localX - 30, localY - 28);
      if (cosmeticId) {
        ctx.fillStyle = cosmeticId === 'ribbon-navy' ? '#244875'
          : cosmeticId === 'nameplate-graduation' ? '#634f8d' : '#e16669';
        ctx.fillRect(localX - 2, localY - 14, 9, 5);
        ctx.fillStyle = '#fff6e4';
        ctx.fillRect(localX, localY - 13, 3, 2);
        if (cosmeticId === 'nameplate-graduation') ctx.fillRect(localX + 4, localY - 13, 2, 2);
      }
      if (tiers[index] === 2) {
        // Bright two-notch crest marks the widened, physical merged duck.
        const x = Math.round(localX), y = Math.round(localY);
        ctx.fillStyle = '#3b302c';
        ctx.fillRect(x - 11, y - 30, 21, 10);
        ctx.fillStyle = kinds[index] === 'bomb' ? '#ffb052'
          : kinds[index] === 'clone' ? '#c5a1fa'
            : kinds[index] === 'pierce' ? '#8db9f0' : '#80e2cd';
        ctx.fillRect(x - 9, y - 28, 7, 6);
        ctx.fillRect(x + 1, y - 28, 7, 6);
        ctx.fillStyle = '#fff8e5';
        ctx.fillRect(x - 7, y - 27, 3, 2);
        ctx.fillRect(x + 3, y - 27, 3, 2);
      }
      if (hitFlash[index] > 0) {
        const alpha = Math.min(1, hitFlash[index]);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fff8d5';
        ctx.fillRect(localX - 12, localY - 6, 8, 4);
        ctx.fillRect(localX - 2, localY - 8, 6, 4);
        ctx.fillRect(localX + 7, localY - 5, 6, 4);
        ctx.fillStyle = '#e58b32';
        ctx.fillRect(localX - 19, localY - 17, 4, 4);
        ctx.fillRect(localX - 15, localY - 23, 2, 4);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      if (showColliders) {
        ctx.strokeStyle = '#f03673';
        ctx.lineWidth = 1;
        for (const part of duck.parts.slice(1)) {
          ctx.beginPath();
          part.vertices.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
          ctx.closePath();
          ctx.stroke();
        }
      }
    });
  }

  private drawRigidPaddle(body: Body): void {
    const ctx = this.ctx;
    const width = tuning.rigid.width;
    const height = tuning.rigid.height;
    ctx.fillStyle = '#5d6167';
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(body.position.x - width / 2, body.position.y - height / 2, width, height, 10);
    ctx.fill();
    ctx.stroke();
  }

  private drawBallTrail(ball: RenderFrame['balls'][number]): void {
    const { ctx } = this;
    const kind = ball.bombArmed ? 'bomb' : ball.isClone ? 'clone'
      : (ball.pierceRemaining ?? 0) > 0 ? 'pierce'
        : ball.elasticMs > 0 ? 'elastic' : null;
    if (!kind) return;
    const vx = ball.body.velocity.x, vy = ball.body.velocity.y;
    const length = Math.hypot(vx, vy) || 1;
    const sideX = -vy / length, sideY = vx / length;
    const trail = ball.trail.slice(0, -1);
    ctx.save();
    trail.forEach((point, i) => {
      ctx.globalAlpha = (0.16 + i / Math.max(1, trail.length) * 0.65)
        * (kind === 'elastic' ? ball.elasticMs / 500 : 1);
      const x = Math.round(point.x), y = Math.round(point.y);
      if (kind === 'bomb') {
        ctx.fillStyle = i % 2 ? '#ffad3e' : '#e9642d';
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.fillStyle = '#ffe290';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      } else {
        ctx.fillStyle = kind === 'clone' ? '#a679d9'
          : kind === 'pierce' ? '#5b92d4' : '#43aab9';
        for (const side of [-1, 1]) {
          ctx.fillRect(Math.round(x + sideX * side * 7) - 2,
            Math.round(y + sideY * side * 7) - 2, 4, 4);
        }
      }
    });
    ctx.restore();
  }

  private drawBall(ballView: RenderFrame['balls'][number], effectTimeMs: number): void {
    const ctx = this.ctx;
    const ball = ballView.body;
    const x = Math.round(ball.position.x) - tuning.ball.radius;
    const y = Math.round(ball.position.y) - tuning.ball.radius;
    if (ballView.bombArmed) {
      const flicker = Math.floor(effectTimeMs / 90) % 2;
      ctx.fillStyle = '#d75030';
      ctx.fillRect(x + 2, y - 5 - flicker * 2, 12, 6);
      ctx.fillRect(x - 5, y + 2, 6, 12);
      ctx.fillRect(x + 15, y + 2, 6, 12);
      ctx.fillRect(x + 3, y + 15, 10, 6);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(x + 4, y - 3 - flicker * 2, 8, 5);
      ctx.fillRect(x - 3, y + 4, 5, 8);
      ctx.fillRect(x + 14, y + 4, 5, 8);
      ctx.fillRect(x + 5, y + 14, 6, 5);
    } else if ((ballView.pierceRemaining ?? 0) > 0) {
      ctx.fillStyle = '#4c7fbd';
      ctx.fillRect(x + 6, y - 5, 4, 6);
      ctx.fillRect(x + 4, y - 2, 8, 3);
      ctx.fillRect(x + 2, y + 1, 12, 2);
    } else if (ballView.elasticMs > 0 || ballView.isClone) {
      ctx.globalAlpha = ballView.isClone ? 1 : ballView.elasticMs / 500;
      ctx.fillStyle = ballView.isClone ? '#875caf' : '#378eab';
      ctx.fillRect(x - 3, y + 2, 3, 12);
      ctx.fillRect(x + 16, y + 2, 3, 12);
      ctx.fillRect(x + 2, y - 3, 12, 3);
      ctx.fillRect(x + 2, y + 16, 12, 3);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#1b2023';
    ctx.fillRect(x + 4, y, 8, 16);
    ctx.fillRect(x, y + 4, 16, 8);
    ctx.fillRect(x + 2, y + 2, 12, 12);
    ctx.fillStyle = '#f7f6f0';
    ctx.fillRect(x + 4, y + 4, 6, 4);
    ctx.fillRect(x + 4, y + 8, 4, 4);
    ctx.fillStyle = ballView.isClone ? '#be9cdb' : '#a3b9b4';
    ctx.fillRect(x + 10, y + 10, 2, 2);
  }

  private drawImpact(impact: NonNullable<RenderFrame['impact']>): void {
    const ctx = this.ctx;
    const distance = 16 + (290 - impact.ms) / 12;
    ctx.save();
    ctx.globalAlpha = Math.min(1, impact.ms / 180);
    ctx.fillStyle = impact.kind === 'bomb' ? '#ec6a31'
      : impact.kind === 'clone' ? '#a679d9'
        : impact.kind === 'pierce' ? '#5b92d4' : '#4bb4bc';
    for (const [x, y] of [[-distance, 0], [distance, 0], [0, -distance], [0, distance]]) {
      ctx.fillRect(Math.round(impact.x + x) - 3, Math.round(impact.y + y) - 3, 6, 6);
    }
    ctx.restore();
  }

  private drawBlast(blast: NonNullable<RenderFrame['blast']>): void {
    const ctx = this.ctx;
    const radius = 9 + (370 - blast.ms) / 15;
    ctx.save();
    ctx.globalAlpha = Math.min(1, blast.ms / 170);
    for (const neighbor of blast.neighbors) {
      ctx.fillStyle = '#f9ab44';
      for (let i = 1; i < 7; i += 1) {
        const t = i / 7;
        ctx.fillRect(Math.round(blast.x + (neighbor.x - blast.x) * t) - 2,
          Math.round(blast.y + (neighbor.y - blast.y) * t) - 2, 5, 5);
      }
    }
    for (const point of [blast, ...blast.neighbors]) {
      ctx.fillStyle = '#e65c30';
      ctx.fillRect(Math.round(point.x) - 8, Math.round(point.y) - 7, 16, 14);
      ctx.fillStyle = '#ffe399';
      ctx.fillRect(Math.round(point.x) - 4, Math.round(point.y) - 4, 8, 8);
      ctx.fillStyle = '#f99536';
      for (const [x, y] of [[-radius, 0], [radius, 0], [0, -radius], [0, radius]]) {
        ctx.fillRect(Math.round(point.x + x) - 3, Math.round(point.y + y) - 3, 6, 6);
      }
    }
    ctx.restore();
  }

  private drawMergeBurst(merge: NonNullable<RenderFrame['mergeBurst']>): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, merge.ms / 240);
    const color = merge.kind === 'bomb' ? '#e7813b'
      : merge.kind === 'clone' ? '#9c71ce'
        : merge.kind === 'pierce' ? '#5b92d4' : '#389f97';
    const radius = 19 + (950 - merge.ms) * 0.055;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(merge.x, merge.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '900 20px system-ui';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#302925';
    ctx.strokeText('합체!', merge.x, merge.y - 40 - (950 - merge.ms) * 0.03);
    ctx.fillStyle = color;
    ctx.fillText('합체!', merge.x, merge.y - 40 - (950 - merge.ms) * 0.03);
    ctx.restore();
  }

  private drawOverlay(phase: RunPhase): void {
    const ctx = this.ctx;
    const labels: Record<RunPhase, string> = {
      READY: 'READY',
      RUNNING: '',
      PAUSED: '',
      CHOOSING: '',
      UPGRADING: '',
      CLEAR: 'CLEAR!',
      LOST: '놓쳤다! 꽥…',
    };
    ctx.fillStyle = 'rgba(247,246,240,.72)';
    ctx.fillRect(0, 245, LOGICAL_WIDTH, 92);
    ctx.fillStyle = '#141414';
    ctx.font = '800 26px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[phase], LOGICAL_WIDTH / 2, 286);
  }
}
