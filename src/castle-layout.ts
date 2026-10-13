import { ISLAND_RADIUS, ISLAND_TOP } from './island';

/** Static, uncollidable castle dimensions shared by the visual builder and its contract tests. */
export const CASTLE_BASE_Y = ISLAND_TOP;
export const CASTLE_HEIGHT = ISLAND_RADIUS * 2.4;
export const CASTLE_TOP_Y = CASTLE_BASE_Y + CASTLE_HEIGHT;
export const CASTLE_FOOTPRINT_RADIUS = 810;

export const CASTLE_LAYOUT = Object.freeze({
  terraces: Object.freeze([
    Object.freeze({ radius: 810, bottom: CASTLE_BASE_Y, height: 80 }),
    Object.freeze({ radius: 700, bottom: CASTLE_BASE_Y + 80, height: 80 }),
    Object.freeze({ radius: 580, bottom: CASTLE_BASE_Y + 160, height: 80 }),
  ]),
  wall: Object.freeze({ sides: 8, radius: 615, bottom: CASTLE_BASE_Y + 160, height: 320, thickness: 34, towerRadius: 82 }),
  sideTowers: Object.freeze({ count: 4, radius: 410, bottom: CASTLE_BASE_Y + 240, bodyHeight: 760, bodyRadius: 82, roofHeight: 300 }),
  lowerKeep: Object.freeze({ radius: 360, bottom: CASTLE_BASE_Y + 240, height: 610 }),
  greatTower: Object.freeze({
    base: CASTLE_BASE_Y + 650,
    lowerRadius: 245,
    lowerHeight: 650,
    middleRadius: 205,
    middleHeight: 490,
    upperRadius: 165,
    upperHeight: 220,
    roofBase: CASTLE_TOP_Y - 430,
    roofHeight: 430,
  }),
});
