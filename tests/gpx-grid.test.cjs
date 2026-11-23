const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync('gpx-grid.js', 'utf8'), context);
const { makeGpxGridProjection, generateGpxGrid } = context;
const origin = [12.836536, 43.557667];
const projection = makeGpxGridProjection(origin);

test('A sparse GPX segment visits each cell in order and can exceed 100 cells', () => {
    const track = [origin, projection.unproject(60000, 0), origin];
    const grid = generateGpxGrid([track], 500, false);
    assert.equal(grid.features.length, 121);
    for (const [index, feature] of grid.features.entries()) {
        assert.equal(feature.properties.name, String(index + 1).padStart(3, '0'));
        assert.equal(feature.properties.grid_index, '0,' + index);
        assert.equal(feature.geometry.type, 'Polygon');
    }
    const ring = grid.features[0].geometry.coordinates[0];
    const projectedRing = Array.from(ring, point => Array.from(projection.project(point), Math.round));
    assert.deepEqual(projectedRing, [[-250, -250], [250, -250], [250, 250], [-250, 250], [-250, -250]]);
});

test('Separate GPX segments stay disconnected and the original track is optional', () => {
    const segments = [
        [origin, projection.unproject(-1250, 0)],
        [projection.unproject(0, 1250), projection.unproject(0, 1600)]
    ];
    const grid = generateGpxGrid(segments, 500, false);
    const indices = Array.from(grid.features, feature => feature.properties.grid_index);
    assert.deepEqual(indices.sort(), ['0,-1', '0,-2', '0,-3', '0,0', '2,0', '3,0']);
    const line = generateGpxGrid(segments, 500, true).features.at(-1).geometry;
    assert.equal(line.type, 'MultiLineString');
    assert.equal(line.coordinates[0], segments[0]);
    assert.equal(line.coordinates[1], segments[1]);
    assert.equal(generateGpxGrid([segments[0]], 500, true).features.at(-1).geometry.type, 'LineString');
    assert.throws(() => generateGpxGrid(segments, 99, false), /gridInvalid/);
});

test('iD accepts a GPX grid larger than 100 cells and protects existing custom data', () => {
    const document = new EventTarget();
    document.documentElement = { dataset: {} };
    const window = new EventTarget();
    let imported;
    const layer = {
        hasData: () => Boolean(imported),
        setFile(extension, data) {
            assert.equal(extension, '.geojson');
            imported = JSON.parse(data);
        },
        enabled() {}
    };
    const editor = {
        graph() {},
        mode: () => ({ id: 'browse' }),
        editable: () => true,
        layers: () => ({ layer: name => name === 'data' && layer })
    };
    vm.runInNewContext(fs.readFileSync('src/id-bridge.js', 'utf8'), {
        window, document, CustomEvent, URL: class extends URL {}, CosmeticsSimplifyBridge() {}, CosmeticsFixerBridge() {}
    });
    window.iD = { coreContext: () => editor };
    window.iD.coreContext();
    const data = generateGpxGrid([[origin, projection.unproject(60000, 0)]], 500, true);
    let result;
    document.addEventListener('cosmetics:grid-result', event => { result = JSON.parse(event.detail); });
    const show = replace => document.dispatchEvent(new CustomEvent('cosmetics:grid-request', {
        detail: JSON.stringify({ action: 'show', data, replace })
    }));
    show(false);
    assert.equal(result.status, 'shown');
    assert.equal(imported.features.length, 122);
    assert.equal(imported.features.at(-1).geometry.type, 'LineString');
    show(false);
    assert.equal(result.status, 'occupied');
    show(true);
    assert.equal(result.status, 'shown');
});
