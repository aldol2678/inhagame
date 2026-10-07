// Metre-authored life props. Room entities use 0.5; NPC arm children divide by avatar scale.
// These fixed bindings are visual-only: no inventory, NPC behavior, collision or RPC changes.
export const LIFE_PROP_WORLD_SCALE = 0.5;
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
  }
}).map(([activity, prop]) => [activity, Object.freeze({ ...prop, position: Object.freeze(prop.position), rotation: Object.freeze(prop.rotation) })])));

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
