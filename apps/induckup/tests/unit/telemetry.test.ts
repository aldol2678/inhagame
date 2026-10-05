import { expect, it } from 'vitest';
import { PilotTelemetry } from '../../src/game/telemetry/PilotTelemetry';

it('keeps maxima and hit counts', () => {
  const telemetry = new PilotTelemetry('living', 2);
  telemetry.start(100);
  telemetry.recordPaddleHit();
  telemetry.recordBrickHit(true);
  telemetry.observeFlex(5.2);
  telemetry.observeFlex(3.1);
  telemetry.observeBallSpeed(321.45);
  const snapshot = telemetry.snapshot(600);
  expect(snapshot.elapsedMs).toBe(500);
  expect(snapshot.paddleHits).toBe(1);
  expect(snapshot.bricksDestroyed).toBe(1);
  expect(snapshot.maxFlexPx).toBe(5.2);
  expect(snapshot.maxBallSpeed).toBe(321.5);
  expect(snapshot.restartCount).toBe(2);
});

it('excludes repeated pauses from elapsed play time', () => {
  const telemetry = new PilotTelemetry('living');
  telemetry.start(100);
  telemetry.pause(250);
  expect(telemetry.snapshot(600).elapsedMs).toBe(150);
  telemetry.pause(300);
  telemetry.resume(700);
  expect(telemetry.snapshot(800).elapsedMs).toBe(250);
  telemetry.pause(850);
  telemetry.resume(1050);
  expect(telemetry.snapshot(1100).elapsedMs).toBe(350);
});
