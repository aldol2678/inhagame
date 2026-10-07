import { CLUB_TABLE_PROPS, LIFE_PROP_MODELS, LIFE_PROP_WORLD_SCALE } from '../life-props.js';
import { createPersonalRoomFixtureModel } from './personal-room-fixture-model.js';

// Reuse the existing room fixture lifecycle: lazy registry loads, single instances,
// old decorations on failure, and no scene insertion after the room is destroyed.
export function createClubTableProps({ app, root, table, height }) {
  const loaders = CLUB_TABLE_PROPS.map(prop => {
    const radians = prop.yaw * Math.PI / 180;
    const [x, y, z] = prop.rest;
    const rotatedRest = [Math.cos(radians) * x + Math.sin(radians) * z, y,
      -Math.sin(radians) * x + Math.cos(radians) * z];
    const target = [prop.restTarget[0], height + prop.restTarget[1], prop.restTarget[2]];
    return createPersonalRoomFixtureModel({ app, root, anchor: table,
      fallback: table.findByName(prop.fallback) ?? { enabled: true },
      model: {
        url: LIFE_PROP_MODELS[prop.id], name: `Club_Life_Prop_${prop.id}`,
        offset: target.map((value, index) => value - LIFE_PROP_WORLD_SCALE * rotatedRest[index]),
        scale: LIFE_PROP_WORLD_SCALE, yaw: prop.yaw
      }
    });
  });
  return () => Promise.all(loaders.map(ensure => ensure()));
}
