import { METERS_PER_WORLD_UNIT, metersToWorld, worldToMeters } from './world-scale.js';
import { WORLD_SCHEMA_VERSION, DEFAULT_COORDINATE_SYSTEM } from './editor/world-schema.js';

// Batch placement authority. XYZ positions are campus logical units, dimensions
// and collision boxes are original Y-up GLB metres. These are game-layout
// placements derived from current campus site/building/road geometry, not surveys.
// Semantic zoneId is getPlaceZoneAt readback; a facade may be assigned a nearby
// zone rather than its building's semantic zone. No interactive behavior here.
export const CAMPUS_STATIC_PROPS = Object.freeze([
  {
    "assetId": "PROP_TRASHBIN_CAMPUS_001",
    "url": "/assets/prop_trashbin_campus_001.glb",
    "position": [
      -4.174096721993891,
      0.018,
      -15.46121105869368
    ],
    "yaw": 0,
    "scale": [
      1,
      1,
      1
    ],
    "siteId": "site_218215618",
    "zoneId": "AREA_JUNGSEOK_WOONAM",
    "placementReason": "Rest-lawn edge, bench offset (-2, -2) logical units",
    "groundOffset": 0.018,
    "groundHeight": 0.0,
    "surfaceId": "site_218215618",
    "authoredDimensions": [
      0.5400000214576721,
      0.9299999475479126,
      0.5
    ],
    "bounds": {
      "min": [
        -0.27000001072883606,
        0,
        -0.25
      ],
      "max": [
        0.27000001072883606,
        0.9299999475479126,
        0.25
      ]
    },
    "meshes": 8,
    "materials": 2,
    "materialNames": [
      "Bin_Metal",
      "Bin_Inset"
    ],
    "triangles": 96,
    "collision": [
      {
        "part": "body",
        "min": [
          -0.27000001072883606,
          0,
          -0.25
        ],
        "max": [
          0.27000001072883606,
          0.9299999475479126,
          0.25
        ]
      }
    ]
  },
  {
    "assetId": "PROP_BOLLARD_CAMPUS_001",
    "url": "/assets/prop_bollard_campus_001.glb",
    "position": [
      -9.45050508468,
      0.018,
      -67.85212835897
    ],
    "yaw": 0,
    "scale": [
      1,
      1,
      1
    ],
    "siteId": "site_218220046",
    "zoneId": "AREA_MAIN_GATE",
    "placementReason": "Road 481241683 segment 3, 30% along +3.3 outward; outside road shoulder",
    "groundOffset": 0.018,
    "groundHeight": 0.0,
    "surfaceId": "site_218220046",
    "authoredDimensions": [
      0.1899999976158142,
      0.8199999928474426,
      0.1899999976158142
    ],
    "bounds": {
      "min": [
        -0.0949999988079071,
        0,
        -0.0949999988079071
      ],
      "max": [
        0.0949999988079071,
        0.8199999928474426,
        0.0949999988079071
      ]
    },
    "meshes": 3,
    "materials": 2,
    "materialNames": [
      "Bollard_Steel",
      "Bollard_Reflector"
    ],
    "triangles": 196,
    "collision": [
      {
        "part": "body",
        "min": [
          -0.0949999988079071,
          0,
          -0.0949999988079071
        ],
        "max": [
          0.0949999988079071,
          0.8199999928474426,
          0.0949999988079071
        ]
      }
    ]
  },
  {
    "assetId": "PROP_BIKERACK_CAMPUS_001",
    "url": "/assets/prop_bikerack_campus_001.glb",
    "position": [
      -44.63949840386693,
      0.022,
      10.43641779007537
    ],
    "yaw": 119.86190323376964,
    "scale": [
      1,
      1,
      1
    ],
    "siteId": "bldg_jungseok",
    "zoneId": "AREA_JUNGSEOK_WOONAM",
    "placementReason": "Jungseok west parking apron road 481241681 segment 2, at(35,3); outside main lane/EV bays",
    "groundOffset": 0.022,
    "groundHeight": 0.0,
    "surfaceId": "road_481241681_2.parking-apron",
    "authoredDimensions": [
      2,
      0.7949999570846558,
      0.5600000023841858
    ],
    "bounds": {
      "min": [
        -1,
        0,
        -0.2800000011920929
      ],
      "max": [
        1,
        0.7949999570846558,
        0.2800000011920929
      ]
    },
    "meshes": 14,
    "materials": 1,
    "materialNames": [
      "Rack_Steel"
    ],
    "triangles": 168,
    "collision": [
      {
        "part": "body",
        "min": [
          -1,
          0,
          -0.2800000011920929
        ],
        "max": [
          1,
          0.7949999570846558,
          0.2800000011920929
        ]
      }
    ]
  },
  {
    "assetId": "PROP_PLANTER_CAMPUS_001",
    "url": "/assets/prop_planter_campus_001.glb",
    "position": [
      114.97230319,
      1.62,
      -70.7211976929
    ],
    "yaw": 30.6786267314,
    "scale": [
      1,
      1,
      1
    ],
    "siteId": "fac_agora_courtyard",
    "zoneId": "AREA_AGORA_6_9",
    "placementReason": "Agora ring edge 0, 70% along -1.8 inward, raised courtyard edge",
    "groundOffset": 0.02,
    "groundHeight": 1.6,
    "surfaceId": "fac_agora_courtyard",
    "authoredDimensions": [
      1.100000023841858,
      0.625,
      0.699999988079071
    ],
    "bounds": {
      "min": [
        -0.550000011920929,
        0,
        -0.3499999940395355
      ],
      "max": [
        0.550000011920929,
        0.625,
        0.3499999940395355
      ]
    },
    "meshes": 12,
    "materials": 3,
    "materialNames": [
      "Planter_Concrete",
      "Planter_Green",
      "Planter_Soil"
    ],
    "triangles": 348,
    "collision": [
      {
        "part": "body",
        "min": [
          -0.550000011920929,
          0,
          -0.3499999940395355
        ],
        "max": [
          0.550000011920929,
          0.625,
          0.3499999940395355
        ]
      }
    ]
  },
  {
    "assetId": "PROP_SIGN_CAMPUS_001",
    "url": "/assets/prop_sign_campus_001.glb",
    "position": [
      80.0023093981,
      0.018,
      -35.0115054999
    ],
    "yaw": 66.97450799,
    "scale": [
      1,
      1,
      1
    ],
    "siteId": "site_218221011",
    "zoneId": "AREA_MAIN_HALL",
    "placementReason": "Lawn beside junction 481241658/481241692; junction vertex 7 offset (-8, -3.4)",
    "groundOffset": 0.018,
    "groundHeight": 0.0,
    "surfaceId": "site_218221011",
    "authoredDimensions": [
      0.8999999761581421,
      2.1000001430511475,
      0.30000001192092896
    ],
    "bounds": {
      "min": [
        -0.44999998807907104,
        0,
        -0.15000000596046448
      ],
      "max": [
        0.44999998807907104,
        2.1000001430511475,
        0.15000000596046448
      ]
    },
    "meshes": 32,
    "materials": 3,
    "materialNames": [
      "Sign_White",
      "Sign_Steel",
      "Sign_Navy"
    ],
    "triangles": 384,
    "collision": [
      {
        "part": "pole",
        "min": [
          -0.045,
          0,
          -0.045
        ],
        "max": [
          0.045,
          1.82,
          0.045
        ]
      }
    ]
  },
  {
    "assetId": "PROP_VENDING_CAMPUS_001",
    "url": "/assets/prop_vending_campus_001.glb",
    "position": [
      39.89111542474466,
      0.03,
      2.721304141731032
    ],
    "yaw": -150.74215512037276,
    "scale": [
      1,
      1,
      1
    ],
    "siteId": "bldg_01",
    "zoneId": "AREA_MAIN_HALL",
    "placementReason": "Main-hall side entrance apron, HALL_FRONT midpoint -12 along -3.2 inward; front away from wall",
    "groundOffset": 0.03,
    "groundHeight": 0.0,
    "surfaceId": "hall_entrance_apron",
    "authoredDimensions": [
      0.949999988079071,
      1.8499999046325684,
      0.8174999952316284
    ],
    "bounds": {
      "min": [
        -0.4749999940395355,
        0,
        -0.375
      ],
      "max": [
        0.4749999940395355,
        1.8499999046325684,
        0.4424999952316284
      ]
    },
    "meshes": 21,
    "materials": 3,
    "materialNames": [
      "Vending_Teal",
      "Vending_Cream",
      "Vending_Dark"
    ],
    "triangles": 252,
    "collision": [
      {
        "part": "body",
        "min": [
          -0.4749999940395355,
          0,
          -0.375
        ],
        "max": [
          0.4749999940395355,
          1.8499999046325684,
          0.4424999952316284
        ]
      }
    ]
  }
].map(prop => Object.freeze(prop)));
export const CAMPUS_STATIC_PROPS_METERS_PER_UNIT = METERS_PER_WORLD_UNIT;
export const CAMPUS_STATIC_PROPS_WORLD = Object.freeze({
  schemaVersion: WORLD_SCHEMA_VERSION,
  worldId: 'world.campus-street-furniture-v1', name: 'Campus street furniture pack v1',
  coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
  assets: CAMPUS_STATIC_PROPS.map(prop => ({ id: prop.assetId, type: 'model', uri: prop.url, metadata: {} })),
  entities: CAMPUS_STATIC_PROPS.map(prop => ({
    id: `prop.${prop.assetId.toLowerCase()}`, name: prop.assetId, kind: 'prop', parentId: null, enabled: true,
    transform: { position: prop.position.map(worldToMeters), rotation: [0, Math.sin(prop.yaw * Math.PI / 360), 0, Math.cos(prop.yaw * Math.PI / 360)], scale: prop.scale },
    tags: ['campus', 'static-furniture'],
    components: { 'core.renderable': { assetId: prop.assetId, castShadow: false, receiveShadow: true, visible: true } },
    metadata: {}
  })), metadata: {}
});

// Existing OBSTACLES authority consumes oriented polygons with vertical bounds.
// Transform each small authored proxy exactly once into logical campus space;
// CampusRoot's Z reflection belongs to rendering and is not applied here.
export const CAMPUS_STATIC_PROP_COLLIDERS = Object.freeze(CAMPUS_STATIC_PROPS.flatMap(prop => {
  const angle = prop.yaw * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return prop.collision.map(({ part, min, max }) => {
    const polygon = [[min[0], min[2]], [max[0], min[2]], [max[0], max[2]], [min[0], max[2]]].map(([x, z]) => Object.freeze({
      x: prop.position[0] + metersToWorld(c * x * prop.scale[0] + s * z * prop.scale[2]),
      z: prop.position[2] + metersToWorld(-s * x * prop.scale[0] + c * z * prop.scale[2])
    }));
    return Object.freeze({
      id: `prop.${prop.assetId.toLowerCase()}.${part}`, assetId: prop.assetId, part,
      polygon: Object.freeze(polygon),
      minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
      minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z)),
      minY: prop.position[1] + metersToWorld(min[1] * prop.scale[1]),
      maxY: prop.position[1] + metersToWorld(max[1] * prop.scale[1])
    });
  });
}));
