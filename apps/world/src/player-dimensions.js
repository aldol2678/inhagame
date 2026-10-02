// 1 world unit is approximately 2 m. Keep the root/network origin and mount unchanged.
export const HUMAN_HEIGHT = 1.75 / 2;
export const PLAYER_ORIGIN_Y = 1.15;
export const WALK_SHAPE = Object.freeze({ radius: .24, footOffset: PLAYER_ORIGIN_Y, headOffset: HUMAN_HEIGHT - PLAYER_ORIGIN_Y });
export const MOUNT_SHAPE = Object.freeze({ radius: 1.2, footOffset: PLAYER_ORIGIN_Y, headOffset: 2.1 });
