// Metre-authored life props. Room entities use 0.5; NPC arm children divide by avatar scale.
// These fixed bindings are visual-only: no inventory, NPC behavior, collision or RPC changes.
export const LIFE_PROP_WORLD_SCALE = 0.5;
// Hand_-1 is a unit-diameter sphere scaled [0.14, 0.15, 0.14] by createHumanAvatar.
export const NPC_ACTIVITY_HAND_RADII = Object.freeze([0.07, 0.075, 0.07]);
// Keep a small contact patch instead of placing the solid hand through a prop's origin.
export const NPC_ACTIVITY_CONTACT_OVERLAP_WORLD = 0.0006;
export const LIFE_PROP_MODELS = Object.freeze({
  "open_book": "/assets/life-props-v1/open_book.glb",
  "takeaway_cup": "/assets/life-props-v1/takeaway_cup.glb",
  "smartphone": "/assets/life-props-v1/smartphone.glb",
  "compact_camera": "/assets/life-props-v1/compact_camera.glb",
  "sandwich": "/assets/life-props-v1/sandwich.glb",
  "open_laptop": "/assets/life-props-v1/open_laptop.glb",
  "stationery_notebook": "/assets/life-props-v1/stationery_notebook.glb"
});

export const NPC_ACTIVITY_PROPS = Object.freeze(Object.fromEntries(Object.entries({
  "READING": {
    "id": "open_book",
    "contactPoint": [0.13606718182563782, 0.018869705498218536, 0],
    "contactNormal": [-1, 0, 0],
    "position": [
      -0.07,
      -0.68,
      0
    ],
    "rotation": [
      0.15628557409255195,
      -0.006823575527878943,
      0.043082360324645234,
      0.9867482801487086
    ]
  },
  "COFFEE": {
    "id": "takeaway_cup",
    "contactPoint": [-0.00418, 0, 0],
    "contactNormal": [-0.998567769, 0.053501504, 0],
    "position": [
      -0.07,
      -0.68,
      0
    ],
    "rotation": [
      0.20778503663329906,
      -0.007256013368105794,
      0.034136858966368686,
      0.9775517396441024
    ]
  },
  "PHONE": {
    "id": "smartphone",
    "contactPoint": [-0.0375, 0.02, 0],
    "contactNormal": [1, 0, 0],
    "position": [
      -0.07,
      -0.68,
      0
    ],
    "rotation": [
      -0.04308236032464522,
      0.8737872629780586,
      0.48434818891287884,
      0.006823575527879004
    ]
  },
  "PHOTO": {
    "id": "compact_camera",
    "contactPoint": [0.012, 0, 0],
    "contactNormal": [-1, 0, 0],
    "position": [
      -0.07,
      -0.68,
      0
    ],
    "rotation": [
      0.42394517989573843,
      0.009983990122772006,
      0.08155010764110686,
      0.9019536486583567
    ]
  },
  "EATING": {
    "id": "sandwich",
    "contactPoint": [-0.022, 0.038, -0.033],
    "contactNormal": [0, 0, 1],
    "position": [
      -0.07,
      -0.68,
      0
    ],
    "rotation": [0.1710646128960291, -0.696364240320019, -0.12278780396897286, 0.6861026878060833]
  }
}).map(([activity, prop]) => [activity, Object.freeze({ ...prop, position: Object.freeze(prop.position), rotation: Object.freeze(prop.rotation), contactPoint: Object.freeze(prop.contactPoint), contactNormal: Object.freeze(prop.contactNormal) })])));

// Targets are relative to the table surface; preserve the club room root Z mirror.
export const CLUB_TABLE_PROPS = Object.freeze([
  {
    "id": "open_laptop",
    "restTarget": [
      0.45,
      0,
      0.05
    ],
    "rest": [
      0,
      0.0,
      0
    ],
    "yaw": 0,
    "fallback": "laptop"
  },
  {
    "id": "takeaway_cup",
    "restTarget": [
      -0.55,
      0,
      -0.12
    ],
    "rest": [
      -0.043,
      -0.07000000029802322,
      0
    ],
    "yaw": 0,
    "fallback": "mug"
  },
  {
    "id": "stationery_notebook",
    "restTarget": [
      -0.1,
      0,
      0.18
    ],
    "rest": [
      0,
      0.0,
      0
    ],
    "yaw": 12,
    "fallback": "papers"
  },
  {
    "id": "open_book",
    "restTarget": [
      -0.4,
      0,
      0.18
    ],
    "rest": [
      0,
      -0.0013204533606767654,
      0
    ],
    "yaw": -8,
    "fallback": null
  }
].map(prop => Object.freeze({ ...prop, restTarget: Object.freeze(prop.restTarget), rest: Object.freeze(prop.rest) })));
