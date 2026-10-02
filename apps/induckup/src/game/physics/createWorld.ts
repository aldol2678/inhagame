import { Bodies, Composite, Engine, type Body } from 'matter-js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, tuning } from '../config/tuning';

export interface WorldRuntime {
  engine: Engine;
  loseSensor: Body;
}

export function createWorld(): WorldRuntime {
  const engine = Engine.create({
    gravity: { x: 0, y: 0, scale: 0 },
    enableSleeping: false,
  });

  const t = tuning.board.wallThickness;
  const wallOptions = { isStatic: true, label: 'wall', restitution: 1 };
  const left = Bodies.rectangle(-t / 2, LOGICAL_HEIGHT / 2, t, LOGICAL_HEIGHT + t * 2, wallOptions);
  const right = Bodies.rectangle(LOGICAL_WIDTH + t / 2, LOGICAL_HEIGHT / 2, t, LOGICAL_HEIGHT + t * 2, wallOptions);
  const top = Bodies.rectangle(LOGICAL_WIDTH / 2, 48 - t / 2, LOGICAL_WIDTH + t * 2, t, wallOptions);
  const loseSensor = Bodies.rectangle(
    LOGICAL_WIDTH / 2,
    tuning.board.loseSensorY,
    LOGICAL_WIDTH,
    18,
    { isStatic: true, isSensor: true, label: 'lose-sensor' },
  );

  Composite.add(engine.world, [left, right, top, loseSensor]);
  return { engine, loseSensor };
}
