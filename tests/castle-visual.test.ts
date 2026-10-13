import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { ISLAND_RADIUS, ISLAND_SIDES, ISLAND_TOP } from '../src/island';
import { CASTLE_BASE_Y, CASTLE_FOOTPRINT_RADIUS, CASTLE_HEIGHT, CASTLE_LAYOUT, CASTLE_TOP_Y } from '../src/castle-layout';
import { castleVisualBounds, createCastleVisual } from '../src/castle-visual';

test('castle rises above the whole island width while every foundation stays on the island top', () => {
  const visual = createCastleVisual();
  try {
    const bounds = castleVisualBounds(visual);
    const inscribedIslandTopRadius = 900 * Math.cos(Math.PI / ISLAND_SIDES);
    assert.equal(CASTLE_BASE_Y, ISLAND_TOP);
    assert.equal(CASTLE_HEIGHT, ISLAND_RADIUS * 2.4);
    assert.equal(CASTLE_TOP_Y - CASTLE_BASE_Y, CASTLE_HEIGHT);
    assert.ok(CASTLE_HEIGHT > ISLAND_RADIUS * 2, 'the castle must exceed the island maximum width');
    assert.ok(CASTLE_FOOTPRINT_RADIUS < inscribedIslandTopRadius, 'the full footprint fits within the 16-sided island top');
    assert.equal(bounds.min.y, ISLAND_TOP);
    assert.equal(bounds.max.y, CASTLE_TOP_Y);
    assert.ok(bounds.maxRadius <= CASTLE_FOOTPRINT_RADIUS + 1e-6, `outermost geometry radius ${bounds.maxRadius}`);
    const great = CASTLE_LAYOUT.greatTower;
    const upperBottom = great.base + great.lowerHeight - 20 + great.middleHeight - 20;
    assert.equal(upperBottom + great.upperHeight, great.roofBase, 'upper tower body meets the roof without a vertical gap');
    assert.equal(great.roofBase + great.roofHeight, CASTLE_TOP_Y, 'the crown retains the specified full height');
    assert.ok(CASTLE_LAYOUT.terraces.every(step => Number.isFinite(step.radius + step.bottom + step.height)));
  } finally {
    visual.dispose();
  }
});

test('tower windows are visible from outside and clear the faceted walls at their top and bottom', () => {
  const visual = createCastleVisual();
  try {
    const windowBatchIndex = visual.group.children.findIndex(child => child.name.endsWith('-window'));
    assert.ok(windowBatchIndex >= 0);
    const positions = visual.geometries[windowBatchIndex].attributes.position;
    let sideTowerPaneVertices = 0;
    let portalVertices = 0;
    let greatTowerPaneVertices = 0;
    let misplacedAtOrigin = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      // The +Z side keep is centered at (0, 410, 0); its lower-floor slit is about 86 m out from that center.
      if (y >= 1129 && y <= 1237 && Math.abs(x) <= 15 && z >= 480 && z <= 510) sideTowerPaneVertices++;
      // The lower keep is centered at world origin; its front arched portal lies near its actual front face.
      if (y >= 1058 && y <= 1328 && Math.abs(x) <= 46 && z >= 320 && z <= 360) portalVertices++;
      // The central tower is rotated so its +Z façade is a true 16-gon facet center.
      if (y >= 1594 && y <= 1772 && Math.abs(x) <= 26 && z >= 220 && z <= 250) greatTowerPaneVertices++;
      // The side-tower windows must not be left on a false ring around the island center.
      const radius = Math.hypot(x, z);
      if (y >= 1129 && y <= 1237 && radius >= 55 && radius <= 115) misplacedAtOrigin++;
    }
    assert.ok(sideTowerPaneVertices > 8, `expected side-tower façade vertices, got ${sideTowerPaneVertices}`);
    assert.ok(portalVertices > 8, `expected a front-facing lower-keep portal, got ${portalVertices}`);
    assert.ok(greatTowerPaneVertices > 8, `expected a central-tower façade window, got ${greatTowerPaneVertices}`);
    assert.equal(misplacedAtOrigin, 0, 'side-tower windows should not be centered on the island');

    visual.group.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    const outsideHit = (angle: number, sourceRadius: number, y: number) => {
      const source = new Vector3(Math.sin(angle) * sourceRadius, y, Math.cos(angle) * sourceRadius);
      const inward = new Vector3(-Math.sin(angle), 0, -Math.cos(angle));
      raycaster.set(source, inward);
      raycaster.far = sourceRadius;
      return raycaster.intersectObjects(visual.group.children, false)[0]?.object.name;
    };
    assert.equal(outsideHit(Math.PI / 4, 320, 1720), 'floating-island-castle-window',
      'a ray toward the main lower-tower pane should hit the pane before the offset buttress');
    assert.equal(outsideHit(Math.PI / 4, 400, 1208), 'floating-island-castle-window',
      'the lower-keep pane bottom must sit outside the taper');
    assert.equal(outsideHit(Math.PI / 4, 400, 1410), 'floating-island-castle-window',
      'the lower-keep pane top must remain visible as the wall tapers inward');
  } finally {
    visual.dispose();
  }
});

test('castle is a finite static low-draw mesh set with bounded buffers and clean disposal', () => {
  const visual = createCastleVisual();
  const geometryDisposals = visual.geometries.map(() => 0);
  const materialDisposals = visual.materials.map(() => 0);
  visual.geometries.forEach((geometry, index) => geometry.addEventListener('dispose', () => geometryDisposals[index]++));
  visual.materials.forEach((material, index) => material.addEventListener('dispose', () => materialDisposals[index]++));
  try {
    assert.ok(visual.drawCalls >= 4 && visual.drawCalls <= 10);
    assert.equal(visual.drawCalls, visual.group.children.length);
    assert.equal(visual.drawCalls, visual.geometries.length);
    assert.equal(visual.drawCalls, visual.materials.length);
    assert.ok(visual.triangleCount > 0 && visual.triangleCount <= 60_000);
    let bufferBytes = 0;
    for (const geometry of visual.geometries) {
      for (const attribute of Object.values(geometry.attributes)) {
        const array = attribute.array as ArrayLike<number> & { byteLength?: number };
        bufferBytes += array.byteLength ?? array.length * 4;
        for (let i = 0; i < array.length; i++) assert.ok(Number.isFinite(array[i]), `non-finite buffer value at ${i}`);
      }
      assert.ok(geometry.index, 'merged static batch should use a finite index buffer');
      const indices = geometry.index!.array;
      bufferBytes += indices.byteLength;
      for (let i = 0; i < indices.length; i++) {
        assert.ok(Number.isFinite(indices[i]), `non-finite index at ${i}`);
        assert.ok(indices[i] < geometry.attributes.position.count, `index out of range at ${i}`);
      }
    }
    assert.ok(bufferBytes < 8 * 1024 * 1024, `castle vertex/index buffers are bounded (${bufferBytes} bytes)`);
  } finally {
    visual.dispose();
    visual.dispose();
  }
  assert.equal(visual.group.children.length, 0);
  assert.equal(visual.geometries.length, 0);
  assert.equal(visual.materials.length, 0);
  assert.ok(geometryDisposals.every(count => count === 1));
  assert.ok(materialDisposals.every(count => count === 1));
});
