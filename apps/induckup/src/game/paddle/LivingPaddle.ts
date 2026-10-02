import { Bodies, Body, Composite, Constraint, Engine } from 'matter-js';
import { LOGICAL_WIDTH, tuning } from '../config/tuning';
import type { PaddleRuntime } from '../core/types';
import { clamp, clampDuckAngle, reflectElasticFromDuck, reflectFromDuck, softSeparation, type ElasticMode } from './duckPhysics';
import { duckKinds, type DuckKind, type FlockLayout } from './duckTypes';
import { adjacentFusionSource } from './duckFusion';
import { computeFlexPx } from './paddleMath';

const LABEL = 'living-duck';
const FUSED_WIDTH_SCALE = 1.35;
const FUSED_HEIGHT_SCALE = 1.12;

function halfWidth(tier: number): number {
  return tuning.paddle.bodyHalfWidth * (tier === 2 ? FUSED_WIDTH_SCALE : 1);
}

function makeDuck(x: number, y: number, index: number, fused = false): Body {
  const { bodyHalfWidth, bodyHalfHeight, headRadius } = tuning.paddle;
  const rx = bodyHalfWidth * (fused ? FUSED_WIDTH_SCALE : 1);
  const ry = bodyHalfHeight * (fused ? FUSED_HEIGHT_SCALE : 1);
  const points = Array.from({ length: 18 }, (_, i) => ({
    x: x + Math.cos(i * Math.PI * 2 / 18) * rx,
    y: y + Math.sin(i * Math.PI * 2 / 18) * ry,
  }));
  const options = { label: LABEL, friction: 0.01, restitution: tuning.paddle.restitutionProfile[index],
    collisionFilter: { group: -41 } };
  const torso = Bodies.fromVertices(x, y, [points], options);
  const head = Bodies.circle(x + 16 + (rx - bodyHalfWidth) * 0.8, y - 11,
    headRadius * (fused ? 1.12 : 1), { ...options, label: 'living-duck-head' });
  const duck = Body.create({
    parts: [torso, head], label: LABEL, density: tuning.paddle.densityProfile[index],
    friction: 0.01, frictionAir: 0.024, restitution: tuning.paddle.restitutionProfile[index],
    collisionFilter: { group: -41 },
  });
  Body.setDensity(duck, tuning.paddle.densityProfile[index]);
  return duck;
}

export class LivingPaddle implements PaddleRuntime {
  readonly mode = 'living' as const;
  readonly bodies: Body[] = [];
  readonly constraints: Constraint[] = [];
  readonly kinds: DuckKind[];
  /** 0 = basic, 1 = evolved, 2 = fused. Fusion replaces two bodies with one. */
  readonly fusionTiers: number[];
  private readonly hitKick = [0, 0, 0, 0, 0];
  private readonly hitFlash = [0, 0, 0, 0, 0];
  private controlledBody: Body;

  constructor(private readonly engine: Engine, centerX: number, layout: FlockLayout = 'off',
    cloneEnabled = false, private readonly elasticMode: ElasticMode = 'standard') {
    this.kinds = [...duckKinds(layout, cloneEnabled)];
    this.fusionTiers = this.kinds.map(kind => kind === 'basic' ? 0 : 1);
    const { duckSpacing, baselineY } = tuning.paddle;
    for (let i = 0; i < 5; i += 1) {
      this.bodies.push(makeDuck(centerX + (i - 2) * duckSpacing, baselineY, i));
    }
    this.controlledBody = this.bodies[2];
    this.connectNeighbors();
    Composite.add(engine.world, [...this.bodies, ...this.constraints]);
  }

  private neighborSpacing(index: number): number {
    return tuning.paddle.duckSpacing
      + (halfWidth(this.fusionTiers[index]) + halfWidth(this.fusionTiers[index + 1])
        - 2 * tuning.paddle.bodyHalfWidth) * 0.75;
  }

  private connectNeighbors(): void {
    const { anchorX } = tuning.paddle;
    for (let i = 0; i < this.bodies.length - 1; i += 1) {
      const leftAnchor = anchorX * halfWidth(this.fusionTiers[i]) / tuning.paddle.bodyHalfWidth;
      const rightAnchor = anchorX * halfWidth(this.fusionTiers[i + 1]) / tuning.paddle.bodyHalfWidth;
      this.constraints.push(Constraint.create({
        bodyA: this.bodies[i], pointA: { x: leftAnchor, y: 1 },
        bodyB: this.bodies[i + 1], pointB: { x: -rightAnchor, y: 1 },
        length: this.neighborSpacing(i) - leftAnchor - rightAnchor,
        stiffness: tuning.paddle.constraintStiffness,
        damping: tuning.paddle.constraintDamping,
        render: { visible: false },
      }));
    }
  }

  update(targetX: number, deltaMs: number): void {
    const center = this.controlledBody;
    const dtScale = clamp(deltaMs / 16.6667, 0.5, 2);
    const controlIndex = this.bodies.indexOf(center);
    let leftPadding = halfWidth(this.fusionTiers[0]) + 2;
    for (let i = 0; i < controlIndex; i++) leftPadding += this.neighborSpacing(i);
    let rightPadding = halfWidth(this.fusionTiers.at(-1) ?? 0) + 2;
    for (let i = controlIndex; i < this.bodies.length - 1; i++) rightPadding += this.neighborSpacing(i);
    const safeTargetX = clamp(targetX, leftPadding, LOGICAL_WIDTH - rightPadding);
    const dx = safeTargetX - center.position.x;
    const dy = tuning.paddle.baselineY - center.position.y;
    Body.applyForce(center, center.position, {
      x: (dx * tuning.paddle.controlSpring - center.velocity.x * tuning.paddle.controlDamping) * dtScale,
      y: (dy * tuning.paddle.verticalSpring * 1.7 - center.velocity.y * tuning.paddle.verticalDamping * 1.3) * dtScale,
    });

    for (let i = 0; i < this.bodies.length; i += 1) {
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const a = this.bodies[i], b = this.bodies[j];
        const x = b.position.x - a.position.x, y = b.position.y - a.position.y;
        const distance = Math.hypot(x, y);
        const minDistance = tuning.paddle.minDuckDistance
          + (halfWidth(this.fusionTiers[i]) + halfWidth(this.fusionTiers[j])
            - 2 * tuning.paddle.bodyHalfWidth) * 0.75;
        const force = softSeparation(distance, minDistance,
          tuning.paddle.separationForce * dtScale);
        if (!force) continue;
        const nx = distance > 0.001 ? x / distance : 1;
        const ny = distance > 0.001 ? y / distance : 0;
        Body.applyForce(a, a.position, { x: -nx * force, y: -ny * force });
        Body.applyForce(b, b.position, { x: nx * force, y: ny * force });
      }
    }

    this.bodies.forEach((duck, index) => {
      const verticalError = tuning.paddle.baselineY - duck.position.y;
      const edgeBias = 1 + Math.abs(index - controlIndex) * 0.08;
      Body.applyForce(duck, duck.position, {
        x: 0,
        y: (verticalError * tuning.paddle.verticalSpring * edgeBias
          - duck.velocity.y * tuning.paddle.verticalDamping) * dtScale,
      });
      const padding = halfWidth(this.fusionTiers[index]) + 2;
      if (duck.position.x < padding) Body.applyForce(duck, duck.position, { x: 0.0008, y: 0 });
      if (duck.position.x > LOGICAL_WIDTH - padding) Body.applyForce(duck, duck.position, { x: -0.0008, y: 0 });

      // Damped angle spring, clamped every tick so compound-body inertia cannot spin the flock.
      const travel = -clamp(duck.velocity.x / 30, -0.13, 0.13);
      const neighbor = this.bodies[index < controlIndex ? index + 1
        : index > controlIndex ? index - 1 : controlIndex];
      const wave = index === controlIndex ? 0 : clamp((neighbor.position.y - duck.position.y) / 100,
        -0.08, 0.08) * (index < controlIndex ? -1 : 1);
      const desired = clampDuckAngle(travel + wave + this.hitKick[index]);
      const follow = index === 0 || index === this.bodies.length - 1 ? 0.12 : 0.17;
      Body.setAngle(duck, clampDuckAngle(duck.angle + (desired - duck.angle) * follow * dtScale));
      Body.setAngularVelocity(duck, duck.angularVelocity * 0.12);
      this.hitKick[index] *= 0.83;
      this.hitFlash[index] = Math.max(0, this.hitFlash[index] - deltaMs / 180);
    });
  }

  onBallHit(ball: Body, duckPart: Body): DuckKind | null {
    const duck = duckPart.parent === duckPart ? duckPart : duckPart.parent;
    const index = this.bodies.indexOf(duck);
    if (index < 0) return null;
    const torso = duck.parts[1];
    const x = ball.position.x - torso.position.x;
    const y = ball.position.y - torso.position.y;
    const localX = x * Math.cos(duck.angle) + y * Math.sin(duck.angle);
    const head = duckPart.label === 'living-duck-head'
      || Math.hypot(ball.position.x - duck.parts[2].position.x,
        ball.position.y - duck.parts[2].position.y) < tuning.paddle.headRadius + tuning.ball.radius + 1;
    const reflection = { contactOffset: localX / halfWidth(this.fusionTiers[index]),
      angle: duck.angle, duckVelocityX: duck.velocity.x, incomingX: ball.velocity.x,
      incomingY: ball.velocity.y, head };
    const direction = this.kinds[index] === 'elastic'
      ? reflectElasticFromDuck(reflection, this.fusionTiers[index] === 2 ? 'strong' : this.elasticMode)
      : reflectFromDuck(reflection);
    Body.setVelocity(ball, direction);
    // Clear the top envelope to avoid an immediate second bounce at the head/torso seam.
    const upperSurface = Math.min(torso.bounds.min.y, duck.parts[2].bounds.min.y);
    if (ball.position.y > upperSurface - tuning.ball.radius - 1) {
      Body.setPosition(ball, { x: ball.position.x, y: upperSurface - tuning.ball.radius - 1 });
    }
    this.hitKick[index] = clampDuckAngle(this.hitKick[index] + localX * 0.004);
    this.hitFlash[index] = 1;
    return this.kinds[index];
  }

  stabilize(): void {
    this.bodies.forEach(duck => {
      Body.setAngle(duck, clampDuckAngle(duck.angle));
      Body.setAngularVelocity(duck, 0);
    });
  }

  getFlexPx(): number { return computeFlexPx(this.bodies.map((body) => body.position)); }
  evolveDuck(index: number, kind: Exclude<DuckKind, 'basic'>): boolean {
    if (index < 0 || index >= this.bodies.length || this.kinds[index] !== 'basic') return false;
    this.kinds[index] = kind;
    this.fusionTiers[index] = 1;
    this.hitFlash[index] = 1;
    return true;
  }
  /** Two neighboring ducks become one wider compound body with a shorter flock. */
  fuseAdjacentDuck(index: number, kind: Exclude<DuckKind, 'basic'>): number | null {
    const source = adjacentFusionSource(this.kinds, index, kind);
    if (source === null || this.fusionTiers[source] !== 1) return null;
    const first = Math.min(source, index);
    const a = this.bodies[source], b = this.bodies[index];
    const newDuck = makeDuck((a.position.x + b.position.x) / 2,
      (a.position.y + b.position.y) / 2, index, true);
    Body.setMass(newDuck, (a.mass + b.mass) * 0.65);
    Body.setVelocity(newDuck, { x: (a.velocity.x + b.velocity.x) / 2,
      y: (a.velocity.y + b.velocity.y) / 2 });
    this.constraints.forEach(constraint => Composite.remove(this.engine.world, constraint));
    this.constraints.length = 0;
    Composite.remove(this.engine.world, a);
    Composite.remove(this.engine.world, b);
    this.bodies.splice(first, 2, newDuck);
    this.kinds.splice(first, 2, kind);
    this.fusionTiers.splice(first, 2, 2);
    this.hitKick.splice(first, 2, 0);
    this.hitFlash.splice(first, 2, 1);
    if (this.controlledBody === a || this.controlledBody === b) this.controlledBody = newDuck;
    this.connectNeighbors();
    Composite.add(this.engine.world, [newDuck, ...this.constraints]);
    return first;
  }
  getHitFlash(): readonly number[] { return this.hitFlash; }
  getCenterX(): number { return this.controlledBody.position.x; }

  destroy(engine: Engine): void {
    this.constraints.forEach((constraint) => Composite.remove(engine.world, constraint));
    this.bodies.forEach((body) => Composite.remove(engine.world, body));
  }
}
