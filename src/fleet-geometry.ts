/** Geometry-only adaptation of fixed Kaisen naval.ts; no source combat rules. */
export const CAPITAL_SHIP = Object.freeze({ length: 270.43, width: 32.97, height: 42, deckHeight: 9 });
export const NAVAL_HULL_SECTIONS: readonly (readonly [number, number])[] = Object.freeze([
  [-.5, .01], [-.46, .075], [-.39, .20], [-.30, .37], [-.19, .48], [-.07, .5], [.18, .5], [.33, .45], [.43, .32], [.48, .19], [.5, .11],
]);
export const NAVAL_HULL_BOTTOM = -3, NAVAL_HULL_BOTTOM_INSET = .32;
export interface FleetPart { shape: 'box' | 'cylinder'; position: readonly [number, number, number]; size: readonly [number, number, number] }
function part(shape: FleetPart['shape'], position: FleetPart['position'], size: FleetPart['size']): FleetPart { return { shape, position, size }; }
export const NAVAL_STRUCTURE_PARTS: readonly FleetPart[] = [
  part('box', [0,12,12], [16,6,100]), part('box', [0,17,10], [12,4,76]), part('box', [0,20.5,-24], [11,7,17]),
  part('box', [0,24.5,-25], [16,1,18]), part('box', [0,26.5,-25], [10,3,14]), part('box', [0,28.3,-25], [14,.6,15]),
  part('box', [0,31.5,-23], [6.2,6,8]), part('box', [0,36,-23], [9.8,3,5]),
  part('cylinder', [0,23.5,-2], [4.2,13,6]), part('cylinder', [0,22.5,34], [4.2,11,6]),
  part('box', [0,21,55], [7,12,9]), part('box', [0,28,55], [10,2,5]),
];
