export const LOGICAL_WIDTH = 360;
export const LOGICAL_HEIGHT = 640;

export const tuning = {
  board: {
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    wallThickness: 24,
    hudHeight: 48,
    loseSensorY: 620,
  },
  ball: {
    radius: 8,
    speed: 5.9,
    minSpeed: 4.8,
    maxSpeed: 7.7,
    launchDelayMs: 900,
    minVerticalSpeedRatio: 0.34,
  },
  paddle: {
    baselineY: 545,
    duckRadius: 22,
    duckSpacing: 43,
    bodyHalfWidth: 23,
    bodyHalfHeight: 14,
    headRadius: 10,
    anchorX: 15,
    maxAngle: 0.244,
    wallTargetPadding: 112,
    controlSpring: 0.00012,
    controlDamping: 0.0017,
    verticalSpring: 0.000028,
    verticalDamping: 0.00125,
    constraintStiffness: 0.43,
    constraintDamping: 0.13,
    minDuckDistance: 38,
    separationForce: 0.0008,
    densityProfile: [0.000765, 0.0009, 0.00108, 0.0009, 0.000765],
    restitutionProfile: [0.82, 0.88, 0.94, 0.88, 0.82],
    maxTargetSpeed: 800,
    hitEnglish: 2.6,
    duckVelocityEnglish: 0.34,
  },
  rigid: {
    width: 214,
    height: 20,
  },
  bricks: {
    columns: 8,
    rows: 5,
    top: 82,
    side: 16,
    gap: 5,
    height: 22,
  },
} as const;

// P0 v0.1.3: restore soft flex, hide debug guides, and prevent near-horizontal ball stalls.
// P0 v0.1.2: prevent wall-crush overlap while preserving living-paddle flex.
// P0 v0.1.1: lighter response while preserving living-paddle flex.
// All values in this file are PROVISIONAL TUNING, not game-design canon.
