// INHA WORLD Combat v0.3 product/build catalog.
// Provenance: inha_world_combat_v9_22_opus_combat_polish.html
// SHA-256: 07272d2883dcd5713bb7d6218e77e286041733db14e36e8db52df37b5eb67490
//
// This module owns static design identity only. It does not activate encounters,
// grant rewards, mutate equipment, resolve enhancement, or bypass server authority.

export const COMBAT_V03_PROTOTYPE = Object.freeze({
  filename: 'inha_world_combat_v9_22_opus_combat_polish.html',
  sha256: '07272d2883dcd5713bb7d6218e77e286041733db14e36e8db52df37b5eb67490',
  actionCount: 6,
  activeLoadoutSize: 3,
  ultimateLoadoutSize: 1,
  traitPointCap: 8,
  enhancementCap: 20
});

export const COMBAT_ACTION_SLOTS = Object.freeze([
  'basic', 'active_1', 'active_2', 'active_3', 'dodge', 'ultimate'
]);

const job = ({ id, activeSkills, ultimates, traitLines }) => Object.freeze({
  id,
  activeSkills: Object.freeze([...activeSkills]),
  ultimates: Object.freeze([...ultimates]),
  traitLines: Object.freeze(traitLines.map(line => Object.freeze({
    id: line.id,
    nodes: Object.freeze([...line.nodes])
  })))
});

export const COMBAT_JOB_CATALOG = Object.freeze({
  blaster: job({
    id: 'blaster',
    activeSkills: [
      'accelerate', 'slide', 'barrage', 'drone',
      'focus_fire', 'tactical_mark', 'rail', 'weak_scan'
    ],
    ultimates: ['overdrive', 'zero_line'],
    traitLines: [
      { id: 'rapid', nodes: ['b_r1', 'b_r2', 'b_r3', 'b_r4', 'b_r5'] },
      { id: 'drone', nodes: ['b_d1', 'b_d2', 'b_d3', 'b_d4', 'b_d5'] },
      { id: 'precision', nodes: ['b_p1', 'b_p2', 'b_p3', 'b_p4', 'b_p5'] }
    ]
  }),
  vanguard: job({
    id: 'vanguard',
    activeSkills: [
      'perfect_guard', 'counter', 'fortress', 'power_charge',
      'ground_break', 'execution', 'blood_rush', 'rampage'
    ],
    ultimates: ['absolute', 'breakthrough'],
    traitLines: [
      { id: 'guard', nodes: ['v_g1', 'v_g2', 'v_g3', 'v_g4', 'v_g5'] },
      { id: 'breaker', nodes: ['v_b1', 'v_b2', 'v_b3', 'v_b4', 'v_b5'] },
      { id: 'berserker', nodes: ['v_z1', 'v_z2', 'v_z3', 'v_z4', 'v_z5'] }
    ]
  }),
  tech: job({
    id: 'tech',
    activeSkills: [
      'arc', 'phase', 'release', 'cryo',
      'overheat', 'catalyst', 'turret', 'barrier'
    ],
    ultimates: ['resonance', 'factory'],
    traitLines: [
      { id: 'resonance', nodes: ['t_r1', 't_r2', 't_r3', 't_r4', 't_r5'] },
      { id: 'status', nodes: ['t_s1', 't_s2', 't_s3', 't_s4', 't_s5'] },
      { id: 'deploy', nodes: ['t_d1', 't_d2', 't_d3', 't_d4', 't_d5'] }
    ]
  }),
  striker: job({
    id: 'striker',
    activeSkills: [
      'rising', 'chase', 'combo_finish', 'phantom',
      'afterimage', 'shadow_execution', 'magnetic', 'shock_knuckle'
    ],
    ultimates: ['never_stop', 'zero_distance'],
    traitLines: [
      { id: 'combo', nodes: ['s_c1', 's_c2', 's_c3', 's_c4', 's_c5'] },
      { id: 'phantom', nodes: ['s_p1', 's_p2', 's_p3', 's_p4', 's_p5'] },
      { id: 'impact', nodes: ['s_i1', 's_i2', 's_i3', 's_i4', 's_i5'] }
    ]
  })
});

export const COMBAT_GEAR_SLOTS = Object.freeze([
  'weapon', 'helmet', 'armor', 'gloves', 'boots', 'accessory', 'core', 'module'
]);

const set = ({ id, pieces, breakpoints }) => Object.freeze({
  id,
  pieces: Object.freeze([...pieces]),
  breakpoints: Object.freeze([...breakpoints])
});

export const COMBAT_SET_CATALOG = Object.freeze({
  m01: set({
    id: 'm01',
    pieces: ['m01_visor', 'm01_frame', 'm01_grips', 'm01_thrusters'],
    breakpoints: [2, 3, 4]
  }),
  bio: set({
    id: 'bio',
    pieces: ['bio_mask', 'mutant_shell', 'bio_gloves', 'bio_boots'],
    breakpoints: [2, 3, 4]
  }),
  dragon: set({
    id: 'dragon',
    pieces: ['dragon_crown', 'dragon_scale', 'dragon_gauntlets', 'dragon_greaves'],
    breakpoints: [2, 3, 4]
  }),
  kinetic: set({
    id: 'kinetic',
    pieces: ['kinetic_visor', 'kinetic_jacket', 'kinetic_wraps', 'kinetic_boots'],
    breakpoints: [2, 3, 4]
  })
});

export function combatV03Summary() {
  const jobs = Object.values(COMBAT_JOB_CATALOG);
  return Object.freeze({
    jobs: jobs.length,
    activeSkills: jobs.reduce((sum, entry) => sum + entry.activeSkills.length, 0),
    ultimates: jobs.reduce((sum, entry) => sum + entry.ultimates.length, 0),
    traitLines: jobs.reduce((sum, entry) => sum + entry.traitLines.length, 0),
    traitNodes: jobs.reduce((sum, entry) =>
      sum + entry.traitLines.reduce((lineSum, line) => lineSum + line.nodes.length, 0), 0),
    gearSlots: COMBAT_GEAR_SLOTS.length,
    gearSets: Object.keys(COMBAT_SET_CATALOG).length
  });
}
