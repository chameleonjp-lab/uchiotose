import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial,
  Shape, ShapeGeometry, TorusGeometry, Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CASTLE_BASE_Y, CASTLE_FOOTPRINT_RADIUS, CASTLE_LAYOUT, CASTLE_TOP_Y,
} from './castle-layout';

type BatchName = 'stone' | 'shadowStone' | 'roof' | 'gold' | 'window';
const batchNames: readonly BatchName[] = ['stone', 'shadowStone', 'roof', 'gold', 'window'];

export interface CastleVisual {
  group: Group;
  geometries: BufferGeometry[];
  materials: Material[];
  drawCalls: number;
  triangleCount: number;
  dispose(): void;
}

const pointAt = (radius: number, angle: number) => ({ x: Math.sin(angle) * radius, z: Math.cos(angle) * radius });
const facetSurfaceRadius = (radiusBottom: number, radiusTop: number, height: number,
  windowBottom: number, cylinderBottom: number, segments: number) => {
  // Anchor the whole flat arch at the wall radius where it begins. On a taper,
  // the wall recedes toward the top, so this keeps even the lower edge visible.
  const t = Math.max(0, Math.min(1, (windowBottom - cylinderBottom) / height));
  return (radiusBottom + (radiusTop - radiusBottom) * t) * Math.cos(Math.PI / segments);
};

function archShape(width: number, height: number): Shape {
  const radius = width / 2;
  const shoulderY = height - radius;
  const shape = new Shape();
  shape.moveTo(-radius, 0);
  shape.lineTo(radius, 0);
  shape.lineTo(radius, shoulderY);
  shape.absarc(0, shoulderY, radius, 0, Math.PI, false);
  shape.closePath();
  return shape;
}

/** Build five static material batches once; callers own and must dispose the returned resources. */
export function createCastleVisual(): CastleVisual {
  const group = new Group();
  group.name = 'floating-island-castle';
  const temporary = new Map<BatchName, BufferGeometry[]>(batchNames.map(name => [name, []]));
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  const add = (batch: BatchName, geometry: BufferGeometry, x = 0, y = 0, z = 0, turn = 0) => {
    geometry.clearGroups();
    const matrix = new Matrix4().makeRotationY(turn);
    matrix.setPosition(x, y, z);
    geometry.applyMatrix4(matrix);
    temporary.get(batch)!.push(geometry);
  };
  const box = (batch: BatchName, width: number, height: number, depth: number,
    x: number, y: number, z: number, turn = 0) => add(batch, new BoxGeometry(width, height, depth), x, y, z, turn);
  const cylinder = (batch: BatchName, radiusTop: number, radiusBottom: number, height: number,
    segments: number, x: number, y: number, z: number, turn = 0) =>
    add(batch, new CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false), x, y, z, turn);
  const cone = (batch: BatchName, radius: number, height: number, segments: number,
    x: number, y: number, z: number, turn = 0) => add(batch, new ConeGeometry(radius, height, segments), x, y, z, turn);
  const torus = (radius: number, tube: number, y: number) => {
    const geometry = new TorusGeometry(radius, tube, 4, 12);
    geometry.rotateX(Math.PI / 2);
    add('gold', geometry, 0, y, 0);
  };
  const radialTorus = (radius: number, tube: number, y: number, x: number, z: number) => {
    const geometry = new TorusGeometry(radius, tube, 4, 12);
    geometry.rotateX(Math.PI / 2);
    add('gold', geometry, x, y, z);
  };
  const arch = (batch: BatchName, width: number, height: number, radius: number, bottom: number,
    angle: number, originX = 0, originZ = 0) => {
    const p = pointAt(radius, angle);
    const geometry = new ShapeGeometry(archShape(width, height), 12);
    add(batch, geometry, originX + p.x, bottom, originZ + p.z, angle);
  };
  const framedWindow = (radius: number, bottom: number, width: number, height: number,
    angle: number, originX = 0, originZ = 0) => {
    arch('gold', width + 9, height + 10, radius + 1.5, bottom - 2, angle, originX, originZ);
    arch('window', width, height, radius + 3.3, bottom, angle, originX, originZ);
  };
  const paneWindow = (radius: number, bottom: number, width: number, height: number,
    angle: number, originX = 0, originZ = 0) =>
    arch('window', width, height, radius + 2, bottom, angle, originX, originZ);
  const tower = (options: {
    angle: number; radius: number; bottom: number; bodyRadius: number; bodyHeight: number;
    roofHeight: number; segments: number; windowWidth: number; windowHeight: number; rows: number;
    roofScale?: number;
  }) => {
    const { angle, radius, bottom, bodyRadius, bodyHeight, roofHeight, segments, windowWidth, windowHeight, rows } = options;
    const p = pointAt(radius, angle);
    const bodyTop = bottom + bodyHeight;
    const roofRadius = bodyRadius * (options.roofScale ?? 1.24);
    const cylinderTurn = angle - Math.PI / segments;
    cylinder('stone', bodyRadius, bodyRadius * 1.08, bodyHeight, segments, p.x, bottom + bodyHeight / 2, p.z, cylinderTurn);
    cylinder('shadowStone', bodyRadius + 8, bodyRadius + 13, 32, segments, p.x, bottom + 22, p.z, cylinderTurn);
    radialTorus(bodyRadius + 5, 4, bodyTop - 12, p.x, p.z);
    radialTorus(roofRadius * .99, 5, bodyTop + 2, p.x, p.z);
    cone('roof', roofRadius, roofHeight, segments, p.x, bodyTop + roofHeight / 2, p.z, cylinderTurn);
    cone('gold', 8, 34, 8, p.x, bodyTop + roofHeight - 17, p.z);

    const faces = Math.max(4, Math.floor(segments / 3));
    for (let row = 0; row < rows; row++) {
      const rowBottom = bottom + 90 + row * Math.max(windowHeight + 70, (bodyHeight - windowHeight - 180) / Math.max(1, rows - 1));
      if (rowBottom + windowHeight > bodyTop - 42) continue;
      const faceRadius = facetSurfaceRadius(bodyRadius * 1.08, bodyRadius, bodyHeight,
        rowBottom, bottom, segments);
      for (let face = 0; face < faces; face++) {
        const faceAngle = angle + face * Math.PI * 2 / faces;
        paneWindow(faceRadius, rowBottom, windowWidth, windowHeight, faceAngle, p.x, p.z);
      }
    }
  };

  try {
    // Three broad, concentric 16-sided plinths make the castle read as rooted in the island.
    for (const [index, terrace] of CASTLE_LAYOUT.terraces.entries()) {
      cylinder(index === 0 ? 'shadowStone' : 'stone', terrace.radius, terrace.radius, terrace.height,
        16, 0, terrace.bottom + terrace.height / 2, 0);
      if (index < 2) torus(terrace.radius - 8, 4, terrace.bottom + terrace.height - 4);
    }
    torus(CASTLE_FOOTPRINT_RADIUS - 18, 5, CASTLE_BASE_Y + 80);

    // Eight curtain-wall spans with merlons. The south gate replaces one span's lower face.
    const wall = CASTLE_LAYOUT.wall;
    const chord = wall.radius * 2 * Math.sin(Math.PI / wall.sides);
    const wallMidRadius = wall.radius * Math.cos(Math.PI / wall.sides);
    const wallTop = wall.bottom + wall.height;
    const gateAngle = 0;
    const gateWidth = 104;
    const gateHeight = 242;
    for (let side = 0; side < wall.sides; side++) {
      const angle = side * Math.PI * 2 / wall.sides;
      const center = pointAt(wallMidRadius, angle);
      const isGate = Math.abs(angle - gateAngle) < 1e-8;
      const fullLength = chord - wall.towerRadius * 2;
      if (isGate) {
        const panelLength = (fullLength - gateWidth) / 2;
        for (const sign of [-1, 1]) {
          const tangent = sign * (gateWidth / 2 + panelLength / 2);
          const x = center.x + Math.cos(angle) * tangent;
          const z = center.z - Math.sin(angle) * tangent;
          box('stone', panelLength, wall.height, wall.thickness, x, wall.bottom + wall.height / 2, z, angle);
        }
        box('stone', gateWidth, wall.height - gateHeight, wall.thickness,
          center.x, wall.bottom + gateHeight + (wall.height - gateHeight) / 2, center.z, angle);
        for (const sign of [-1, 1]) {
          const tangent = sign * (gateWidth / 2 - 8);
          const x = center.x + Math.cos(angle) * tangent;
          const z = center.z - Math.sin(angle) * tangent;
          box('stone', 18, gateHeight, wall.thickness + 5, x, wall.bottom + gateHeight / 2, z, angle);
        }
        const doorFront = wallMidRadius + wall.thickness / 2 + 3;
        arch('gold', gateWidth + 8, gateHeight + 10, doorFront, wall.bottom - 2, angle);
        arch('window', gateWidth - 8, gateHeight - 8, doorFront + 2.1, wall.bottom, angle);
      } else {
        box('stone', fullLength, wall.height, wall.thickness, center.x, wall.bottom + wall.height / 2, center.z, angle);
      }
      const merlonCount = 6;
      for (let tooth = 0; tooth < merlonCount; tooth++) {
        const tangent = -chord / 2 + (tooth + .5) * chord / merlonCount;
        if (isGate && Math.abs(tangent) < gateWidth / 2 + 12) continue;
        const x = pointAt(wallMidRadius, angle).x + Math.cos(angle) * tangent;
        const z = pointAt(wallMidRadius, angle).z - Math.sin(angle) * tangent;
        box('stone', 28, 48, wall.thickness + 4, x, wallTop + 24, z, angle);
      }
    }

    // Main lower keep: faceted masonry with an accessible arched portal and a crenellated crown.
    const keep = CASTLE_LAYOUT.lowerKeep;
    const keepTop = keep.bottom + keep.height;
    const keepTurn = -Math.PI / 16;
    cylinder('stone', keep.radius - 34, keep.radius, keep.height, 16, 0, keep.bottom + keep.height / 2, 0, keepTurn);
    cylinder('shadowStone', keep.radius + 8, keep.radius + 15, 42, 16, 0, keep.bottom + 26, 0, keepTurn);
    const keepTopRadius = keep.radius - 34;
    cylinder('shadowStone', keepTopRadius + 44, keepTopRadius, 48, 16,
      0, keepTop + 12, 0, keepTurn);
    radialTorus(keepTopRadius + 8, 4, keepTop - 1, 0, 0);
    radialTorus(keepTopRadius + 38, 5, keepTop + 30, 0, 0);
    for (let tooth = 0; tooth < 16; tooth++) {
      const angle = tooth * Math.PI * 2 / 16;
      const p = pointAt(keepTopRadius + 20, angle);
      box('stone', 44, 52, 40, p.x, keepTop + 24, p.z, angle);
    }
    for (let face = 0; face < 8; face++) {
      const angle = face * Math.PI / 4;
      const bottom = keep.bottom + 166;
      const radius = facetSurfaceRadius(keep.radius, keep.radius - 34, keep.height, bottom, keep.bottom, 16);
      framedWindow(radius, bottom, 54, 206, angle);
    }
    const gateBottom = keep.bottom + 18;
    const gateFaceRadius = facetSurfaceRadius(keep.radius, keep.radius - 34, keep.height, gateBottom, keep.bottom, 16);
    framedWindow(gateFaceRadius, gateBottom, 84, 270, 0);
    // The great tower's successively narrower drums and swept, steep roof establish a clear skyline.
    const great = CASTLE_LAYOUT.greatTower;
    const lowerBottom = great.base;
    const middleBottom = lowerBottom + great.lowerHeight - 20;
    const upperBottom = middleBottom + great.middleHeight - 20;
    const lowerTop = lowerBottom + great.lowerHeight;
    const middleTop = middleBottom + great.middleHeight;
    const upperTop = upperBottom + great.upperHeight;
    const greatTurn = -Math.PI / 16;
    cylinder('stone', great.lowerRadius - 10, great.lowerRadius, great.lowerHeight, 16,
      0, lowerBottom + great.lowerHeight / 2, 0, greatTurn);
    cylinder('shadowStone', great.lowerRadius + 17, great.lowerRadius + 21, 38, 16, 0, lowerTop - 12, 0, greatTurn);
    radialTorus(great.lowerRadius + 25, 7, lowerTop + 6, 0, 0);
    cylinder('stone', great.middleRadius - 7, great.middleRadius, great.middleHeight, 16,
      0, middleBottom + great.middleHeight / 2, 0, greatTurn);
    cylinder('shadowStone', great.middleRadius + 14, great.middleRadius + 18, 34, 16, 0, middleTop - 10, 0, greatTurn);
    radialTorus(great.middleRadius + 21, 6, middleTop + 5, 0, 0);
    cylinder('stone', great.upperRadius - 5, great.upperRadius, great.upperHeight, 16,
      0, upperBottom + great.upperHeight / 2, 0, greatTurn);
    cylinder('shadowStone', great.upperRadius + 11, great.upperRadius + 15, 28, 16, 0, upperTop - 8, 0, greatTurn);
    cylinder('shadowStone', great.upperRadius + 26, great.upperRadius + 20, 26, 16, 0, great.roofBase - 7, 0, greatTurn);
    radialTorus(great.upperRadius + 17, 5, great.roofBase + 1, 0, 0);
    cone('roof', great.upperRadius * 1.34, great.roofHeight, 16, 0, great.roofBase + great.roofHeight / 2, 0, greatTurn);
    cone('gold', 12, 58, 8, 0, CASTLE_TOP_Y - 29, 0);

    // Eight projecting ribs brace the main drum; the rich gold imposts accent its stacked levels.
    for (let rib = 0; rib < 8; rib++) {
      const angle = (rib + .5) * Math.PI / 4;
      const p = pointAt(291, angle);
      box('stone', 52, 560, 146, p.x, lowerBottom + 330, p.z, angle);
    }
    // The radialTorus eaves above are the single gold band at each level.
    for (const [radiusBottom, radiusTop, segmentHeight, cylinderBottom, bottom, width, height] of [
      [great.lowerRadius, great.lowerRadius - 10, great.lowerHeight, lowerBottom, lowerBottom + 144, 48, 178],
      [great.middleRadius, great.middleRadius - 7, great.middleHeight, middleBottom, middleBottom + 136, 42, 156],
      [great.upperRadius, great.upperRadius - 5, great.upperHeight, upperBottom, upperBottom + 40, 34, 94],
    ]) {
      const radius = facetSurfaceRadius(radiusBottom, radiusTop, segmentHeight, bottom, cylinderBottom, 16);
      for (let face = 0; face < 8; face++) {
        const angle = face * Math.PI / 4;
        framedWindow(radius, bottom, width, height, angle);
      }
    }

    // Four elevated side keeps and eight lower curtain towers create a layered 360-degree silhouette.
    const sideTowers = CASTLE_LAYOUT.sideTowers;
    for (let i = 0; i < sideTowers.count; i++) tower({
      angle: i * Math.PI / 2, radius: sideTowers.radius, bottom: sideTowers.bottom,
      bodyRadius: sideTowers.bodyRadius, bodyHeight: sideTowers.bodyHeight, roofHeight: sideTowers.roofHeight,
      segments: 12, windowWidth: 28, windowHeight: 106, rows: 2, roofScale: 1.28,
    });
    for (let i = 0; i < wall.sides; i++) tower({
      angle: (i + .5) * Math.PI * 2 / wall.sides, radius: wall.radius, bottom: wall.bottom,
      bodyRadius: wall.towerRadius, bodyHeight: 490, roofHeight: 200,
      segments: 12, windowWidth: 22, windowHeight: 86, rows: 1, roofScale: 1.28,
    });

    const colors: Record<BatchName, number> = {
      stone: 0xd9d3c5,
      shadowStone: 0xbab6aa,
      roof: 0x172d4d,
      gold: 0xc8a958,
      window: 0x263744,
    };
    for (const name of batchNames) {
      const parts = temporary.get(name)!;
      if (!parts.length) continue;
      const geometry = mergeGeometries(parts, false);
      if (!geometry) throw new Error(`Castle ${name} geometry did not merge`);
      const material = new MeshStandardMaterial({ color: colors[name], roughness: name === 'roof' ? .72 : .92, metalness: name === 'gold' ? .48 : 0 });
      const mesh = new Mesh(geometry, material);
      mesh.name = `floating-island-castle-${name}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
      geometries.push(geometry);
      materials.push(material);
    }
  } finally {
    for (const parts of temporary.values()) for (const geometry of parts) geometry.dispose();
  }

  let disposed = false;
  const triangleCount = geometries.reduce((total, geometry) => total +
    (geometry.index?.count ?? geometry.attributes.position.count) / 3, 0);
  return {
    group, geometries, materials, drawCalls: group.children.length, triangleCount,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      geometries.length = 0;
      materials.length = 0;
    },
  };
}

export function castleVisualBounds(visual: CastleVisual) {
  const vector = new Vector3();
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let maxRadius = 0;
  for (const geometry of visual.geometries) {
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      vector.set(position.getX(i), position.getY(i), position.getZ(i));
      min.x = Math.min(min.x, vector.x); min.y = Math.min(min.y, vector.y); min.z = Math.min(min.z, vector.z);
      max.x = Math.max(max.x, vector.x); max.y = Math.max(max.y, vector.y); max.z = Math.max(max.z, vector.z);
      maxRadius = Math.max(maxRadius, Math.hypot(vector.x, vector.z));
    }
  }
  return { min, max, maxRadius };
}
