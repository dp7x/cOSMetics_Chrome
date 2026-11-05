import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

// The overlay is deliberately read-only. Editing remains entirely in iD.
const CATALOG = 'https://stac.overturemaps.org/catalog.json';
const TILES = release => `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${release}/buildings.pmtiles`;
const BUTTON_ID = 'cosmetics-overture-toggle';
const MIN_ZOOM = 18;
const SNAPSHOT_MARGIN = 0.2;  // 20% of viewport width/height on each side
const MAX_TILES = 24;
const MAX_FEATURES = 5000;
const TILE_CACHE_LIMIT = 48;
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

if (!document.documentElement.dataset.cosmeticsOverture) {
  document.documentElement.dataset.cosmeticsOverture = 'loaded';
  let loading = false;
  let archive;
  let maxZoom = 14;
  let canvas;
  let control;
  let button;
  let addButton;
  let clearButton;
  let status;
  let generation = 0;
  let lastView = '';
  let displayed = [];
  let selected = null;
  let snapshot = [];
  let blocked = new Set();
  const cache = new Map();
  const accepted = new Set();
  let osmRefreshTimer;
  let enabled = false;
  let controlPosition = null;
  let positionChanged = false;

  function view() {
    let hash = location.hash;
    try {
      if (!hash.includes('map=') && window.parent !== window) hash = window.parent.location.hash;
    } catch (_) {
      // The frame may have a different origin; use its own URL.
    }
    const match = hash.match(/(?:^|[&#])map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
    // .map-pane is the slide-out Background/Map Data panel, not the map.
    const map = document.querySelector('.main-map');
    if (!match || !map) return null;
    const zoom = Number(match[1]);
    const lat = Number(match[2]);
    const lon = Number(match[3]);
    const rect = map.getBoundingClientRect();
    if (![zoom, lat, lon, rect.width, rect.height].every(Number.isFinite) || rect.width < 1) return null;
    return { zoom, lat, lon, width: rect.width, height: rect.height, map };
  }

  function world(lon, lat, zoom) {
    const scale = 256 * 2 ** zoom;
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    return {
      x: (lon + 180) / 360 * scale,
      y: (1 - Math.asinh(Math.tan(safeLat * Math.PI / 180)) / Math.PI) / 2 * scale
    };
  }

  function visibleBounds(v, margin = 0) {
    const scale = 256 * 2 ** v.zoom;
    const center = world(v.lon, v.lat, v.zoom);
    const lon = x => x / scale * 360 - 180;
    const lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI;
    return {
      minX: lon(center.x - v.width * (0.5 + margin)),
      maxX: lon(center.x + v.width * (0.5 + margin)),
      minY: lat(center.y + v.height * (0.5 + margin)),
      maxY: lat(center.y - v.height * (0.5 + margin))
    };
  }

  function intersectsVisible(ring, box) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return !(maxX < box.minX || minX > box.maxX || maxY < box.minY || minY > box.maxY);
  }

  function setStatus(message) {
    if (status) {
      status.textContent = message;
      status.hidden = !message;
      requestAnimationFrame(placeControl);
    }
  }

  function updateControls() {
    if (addButton) addButton.hidden = !selected;
    if (clearButton) {
      clearButton.hidden = snapshot.length === 0;
      clearButton.disabled = loading;
    }
  }

  async function initialize() {
    if (archive) return;
    const response = await fetch(CATALOG);
    if (!response.ok) throw new Error(`STAC: HTTP ${response.status}`);
    const catalog = await response.json();
    // The root catalog has a top-level "latest" string. Do not rely on
    // release links or labels, whose order and representation can change.
    const release = catalog.latest;
    if (typeof release !== 'string' || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release)) {
      throw new Error(t('releaseMissing'));
    }
    const candidate = new PMTiles(TILES(release));
    const header = await candidate.getHeader();
    maxZoom = header.maxZoom;
    archive = candidate;
    setStatus(`Overture ${release}`);
  }

  function ensureCanvas(v) {
    if (canvas?.parentElement !== v.map) {
      canvas?.remove();
      canvas = document.createElement('canvas');
      canvas.id = 'cosmetics-overture-overlay';
      canvas.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;';
      v.map.appendChild(canvas);
    }
    const ratio = devicePixelRatio || 1;
    canvas.style.width = `${v.width}px`;
    canvas.style.height = `${v.height}px`;
    canvas.width = Math.round(v.width * ratio);
    canvas.height = Math.round(v.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }

  async function tile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) {
      const result = cache.get(key);
      cache.delete(key);
      cache.set(key, result);
      return result;
    }
    const result = archive.getZxy(z, x, y).then(response => {
      if (!response) return null;
      const data = new VectorTile(new PbfReader(response.data));
      return data.layers.building || null;
    }).catch(error => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, result);
    if (cache.size > TILE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return result;
  }

  function drawSnapshot(ctx, v) {
    const center = world(v.lon, v.lat, v.zoom);
    const viewport = visibleBounds(v);
    let count = 0;
    for (const { feature, geometry, source, id, x: tx, y: ty, z, key } of snapshot) {
      if (accepted.has(id) || blocked.has(key)) continue;
      const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : null;
      if (ring && !intersectsVisible(ring, viewport)) continue;
      const factor = 2 ** (v.zoom - z) * 256;
      const paths = feature.loadGeometry();
      const shape = new Path2D();
      const screenRings = [];
      for (const ring of paths) {
        const screenRing = [];
        ring.forEach((point, index) => {
          const x = (tx + point.x / feature.extent) * factor - center.x + v.width / 2;
          const y = (ty + point.y / feature.extent) * factor - center.y + v.height / 2;
          screenRing.push([x, y]);
          if (index === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
        });
        shape.closePath();
        screenRings.push(screenRing);
      }
      const active = selected?.id === id;
      ctx.fillStyle = active ? 'rgba(255, 205, 0, 0.65)' : 'rgba(255, 156, 0, 0.28)';
      ctx.strokeStyle = active ? '#b00000' : '#e07000';
      ctx.lineWidth = active ? 3 : 1.5;
      ctx.fill(shape, 'evenodd');
      ctx.stroke(shape);
      displayed.push({
        id, screenRings,
        geometry, source
      });
      count++;
    }
    return count;
  }

  function hideExistingBuildings(candidates) {
    let blocked = [];
    const receive = event => { blocked = event.detail.blocked || []; };
    document.addEventListener('cosmetics:check-buildings-result', receive, { once: true });
    document.dispatchEvent(new CustomEvent('cosmetics:check-buildings', { detail: { candidates } }));
    document.removeEventListener('cosmetics:check-buildings-result', receive);
    return new Set(blocked);
  }

  function render() {
    if (!enabled || !snapshot.length) return;
    const v = view();
    if (!v) return;
    const ctx = ensureCanvas(v);
    ctx.clearRect(0, 0, v.width, v.height);
    displayed = [];
    if (v.zoom < MIN_ZOOM) {
      selected = null;
      updateControls();
      setStatus(t('zoomToShow', String(MIN_ZOOM)));
      return;
    }
    const count = drawSnapshot(ctx, v);
    if (selected && !displayed.some(item => item.id === selected.id)) selected = null;
    updateControls();
    setStatus(selected ? t('buildingSelected') : t('buildingsVisible', String(count)));
  }

  async function loadSnapshot() {
    if (!enabled || loading) return;
    const v = view();
    if (!v) return;
    if (v.zoom < MIN_ZOOM) {
      setStatus(t('zoomToLoad', String(MIN_ZOOM)));
      return;
    }
    const current = ++generation;
    loading = true;
    button.disabled = true;
    button.textContent = t('loading');
    button.setAttribute('aria-pressed', 'true');
    updateControls();
    setStatus(t('loadingArea'));
    try {
      await initialize();
      const z = Math.min(Math.floor(v.zoom), maxZoom);
      const center = world(v.lon, v.lat, v.zoom);
      const scale = 256 * 2 ** (v.zoom - z);
      const halfWidth = v.width * (0.5 + SNAPSHOT_MARGIN);
      const halfHeight = v.height * (0.5 + SNAPSHOT_MARGIN);
      const left = Math.floor((center.x - halfWidth) / scale);
      const right = Math.floor((center.x + halfWidth) / scale);
      const top = Math.floor((center.y - halfHeight) / scale);
      const bottom = Math.floor((center.y + halfHeight) / scale);
      const coords = [];
      for (let y = Math.max(0, top); y <= Math.min(2 ** z - 1, bottom); y++) {
        for (let x = Math.max(0, left); x <= Math.min(2 ** z - 1, right); x++) coords.push([x, y]);
      }
      if (coords.length > MAX_TILES) throw new Error(t('zoomInToLoad'));
      const layers = await Promise.all(coords.map(async ([x, y]) => [x, y, await tile(z, x, y)]));
      if (current !== generation) return;
      const items = [];
      const candidates = [];
      const bounds = visibleBounds(v, SNAPSHOT_MARGIN);
      for (const [x, y, layer] of layers) {
        if (!layer) continue;
        for (let i = 0; i < Math.min(layer.length, MAX_FEATURES); i++) {
          const feature = layer.feature(i);
          if (feature.type !== 3) continue;
          const source = feature.properties['@geometry_source'];
          if (source !== 'Microsoft ML Buildings' && source !== 'Google Open Buildings') continue;
          const key = `${z}/${x}/${y}/${i}`;
          const id = feature.properties.id ?? key;
          if (accepted.has(id)) continue;
          const geometry = feature.toGeoJSON(x, y, z).geometry;
          const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : null;
          if (ring && !intersectsVisible(ring, bounds)) continue;
          items.push({ feature, geometry, source, id, key, x, y, z });
          if (ring) candidates.push({ key, ring });
        }
      }
      const excluded = hideExistingBuildings(candidates);
      if (current !== generation) return;
      snapshot = items;
      blocked = excluded;
      selected = null;
      const currentView = view();
      lastView = currentView ? [currentView.zoom, currentView.lat, currentView.lon,
        currentView.width, currentView.height].join('/') : '';
      if (snapshot.length) render();
      else {
        displayed = [];
        canvas?.remove();
        canvas = null;
        setStatus(t('noCandidates'));
      }
    } catch (error) {
      console.error('cOSMetics Overture:', error);
      setStatus(`Overture: ${error.message}`);
    } finally {
      loading = false;
      button.disabled = false;
      button.textContent = t('loadArea');
      button.setAttribute('aria-pressed', 'false');
      updateControls();
    }
  }

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) &&
          x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function pick(event) {
    if (!enabled || !snapshot.length || event.button !== 0) return;
    const v = view();
    if (!v) return;
    const rect = v.map.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const found = [...displayed].reverse().find(item =>
      item.screenRings.reduce((inside, ring) => inside !== pointInRing(x, y, ring), false));
    if (!found) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selected = found;
    render();
  }

  function addSelected() {
    if (!enabled || !selected) return;
    const geometry = selected.geometry;
    // An OSM way is a single closed outer ring. Reject multipolygons or holes
    // rather than silently dropping parts of the Overture feature.
    if (geometry.type !== 'Polygon' || geometry.coordinates.length !== 1) {
      setStatus(t('complexGeometry'));
      return;
    }
    if (document.documentElement.dataset.cosmeticsIdBridge !== 'ready') {
      setStatus(t('bridgeUnavailable'));
      return;
    }
    document.dispatchEvent(new CustomEvent('cosmetics:add-building', {
      detail: { ring: geometry.coordinates[0], source: selected.source, annotation: t('addBuildingAnnotation') }
    }));
  }

  function accept(event) {
    if (!enabled || !selected || event.key.toLowerCase() !== 'a' ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addSelected();
  }

  function clearSnapshot() {
    generation++;
    snapshot = [];
    blocked = new Set();
    selected = null;
    displayed = [];
    clearTimeout(osmRefreshTimer);
    canvas?.remove();
    canvas = null;
    setStatus('');
    updateControls();
  }

  function setEnabled(value) {
    enabled = value === true;
    if (!enabled) clearSnapshot();
    if (control) {
      control.style.display = enabled ? 'grid' : 'none';
      if (enabled) requestAnimationFrame(placeControl);
    }
  }

  const POSITION_KEY = 'overtureControlPosition';
  function positionBounds() {
    const map = document.querySelector('.main-map');
    if (!map || !control || control.style.display === 'none') return null;
    control.style.maxWidth = `${Math.max(1, innerWidth - 24)}px`;
    const box = control.getBoundingClientRect();
    const left = 8;
    const top = 8;
    return {
      left, top,
      right: Math.max(left, innerWidth - 8 - box.width),
      bottom: Math.max(top, innerHeight - 8 - box.height)
    };
  }

  function placeControl() {
    const bounds = positionBounds();
    if (!bounds) return;
    const x = controlPosition ? bounds.left + controlPosition.x * (bounds.right - bounds.left) : bounds.right;
    const y = controlPosition ? bounds.top + controlPosition.y * (bounds.bottom - bounds.top) : bounds.bottom - 34;
    control.style.left = `${Math.max(bounds.left, Math.min(bounds.right, x))}px`;
    control.style.top = `${Math.max(bounds.top, Math.min(bounds.bottom, y))}px`;
  }

  function moveControl(x, y) {
    const bounds = positionBounds();
    if (!bounds) return;
    x = Math.max(bounds.left, Math.min(bounds.right, x));
    y = Math.max(bounds.top, Math.min(bounds.bottom, y));
    control.style.left = `${x}px`;
    control.style.top = `${y}px`;
    controlPosition = {
      x: bounds.right > bounds.left ? (x - bounds.left) / (bounds.right - bounds.left) : 0,
      y: bounds.bottom > bounds.top ? (y - bounds.top) / (bounds.bottom - bounds.top) : 0
    };
  }

  function makeDraggable(handle) {
    let drag = null;
    const persist = () => {
      if (controlPosition) chrome.storage.local.set({ [POSITION_KEY]: controlPosition });
    };
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      event.stopPropagation();
      positionChanged = true;
      const rect = control.getBoundingClientRect();
      drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      moveControl(event.clientX - drag.dx, event.clientY - drag.dy);
    });
    const finish = event => {
      if (!drag || event.pointerId !== drag.id) return;
      event.stopPropagation();
      const id = drag.id;
      drag = null;
      handle.classList.remove('dragging');
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      persist();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      positionChanged = true;
      controlPosition = null;
      chrome.storage.local.remove(POSITION_KEY);
      placeControl();
    });
    handle.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (event.key !== 'Home' && !offsets[event.key]) return;
      event.preventDefault();
      event.stopPropagation();
      positionChanged = true;
      if (event.key === 'Home') {
        controlPosition = null;
        chrome.storage.local.remove(POSITION_KEY);
        placeControl();
        return;
      }
      const rect = control.getBoundingClientRect();
      const step = event.shiftKey ? 1 : 10;
      const [dx, dy] = offsets[event.key];
      moveControl(rect.left + dx * step, rect.top + dy * step);
      persist();
    });
    chrome.storage.local.get(POSITION_KEY, items => {
      const saved = items[POSITION_KEY];
      if (!positionChanged && saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        controlPosition = { x: Math.max(0, Math.min(1, saved.x)), y: Math.max(0, Math.min(1, saved.y)) };
        placeControl();
      }
    });
    window.addEventListener('resize', placeControl);
    const map = document.querySelector('.main-map');
    if (map && typeof ResizeObserver !== 'undefined') new ResizeObserver(placeControl).observe(map);
    // Keep the panel inside the map when its status text or action row changes height.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(placeControl).observe(control);
  }

  function controlStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #cosmetics-overture-toggle {
        --co-bg:#f5f5f5; --co-text:#333; --co-muted:#555; --co-border:#d4d8dc;
        --co-button:#fff; --co-hover:#e8ecef; --co-heading:#287c36; --co-link:#176aa6;
        position:fixed; right:auto; bottom:auto; z-index:1000;
        width:350px; max-width:calc(100vw - 24px); box-sizing:border-box;
        display:none; gap:4px; background:var(--co-bg); color:var(--co-text);
        padding:8px 10px; border:1px solid var(--co-border); border-radius:7px;
        font:12px/1.35 sans-serif; box-shadow:0 2px 10px #0003; color-scheme:light;
      }
      #cosmetics-overture-toggle .co-heading {
        display:flex; align-items:center; gap:8px; color:var(--co-heading);
        cursor:grab; touch-action:none; user-select:none; min-height:20px;
      }
      #cosmetics-overture-toggle .co-heading.dragging { cursor:grabbing; }
      #cosmetics-overture-toggle .co-heading:focus-visible { outline:2px solid var(--co-link); outline-offset:2px; }
      #cosmetics-overture-toggle .co-heading strong { font-size:13px; flex:1; }
      #cosmetics-overture-toggle .co-grip { font-size:17px; color:var(--co-muted); line-height:1; }
      #cosmetics-overture-toggle .co-actions { display:flex; flex-wrap:wrap; gap:5px; }
      #cosmetics-overture-toggle button {
        width:auto; height:auto; margin:0; padding:5px 8px; cursor:pointer;
        border:1px solid var(--co-border); border-radius:4px;
        background:var(--co-button); color:var(--co-text); font:12px/1.3 sans-serif;
      }
      #cosmetics-overture-toggle button:hover { background:var(--co-hover); }
      #cosmetics-overture-toggle button.co-load { background:#1769b5; color:#fff; border-color:#1769b5; }
      #cosmetics-overture-toggle button.co-load:hover { background:#12548f; }
      #cosmetics-overture-toggle button:disabled { opacity:.65; cursor:wait; }
      #cosmetics-overture-toggle [hidden] { display:none !important; }
      #cosmetics-overture-toggle .co-status { color:var(--co-muted); overflow-wrap:anywhere; }
      #cosmetics-overture-toggle .co-attribution {
        border-top:1px solid var(--co-border); padding-top:4px;
        color:var(--co-muted); font-size:10px; overflow-wrap:anywhere;
      }
      #cosmetics-overture-toggle a { color:var(--co-link); text-decoration:none; }
      #cosmetics-overture-toggle a:hover { text-decoration:underline; }
      @media (prefers-color-scheme:dark) {
        #cosmetics-overture-toggle {
          --co-bg:#25282d; --co-text:#edf0f3; --co-muted:#c2c8ce; --co-border:#505760;
          --co-button:#353b43; --co-hover:#454e59; --co-heading:#8ddd95; --co-link:#8dc9ff;
          color-scheme:dark; box-shadow:0 2px 12px #0006;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setup() {
    if (document.getElementById(BUTTON_ID) || !document.querySelector('.main-map')) return;
    control = document.createElement('div');
    control.id = BUTTON_ID;
    controlStyles();
    const handle = document.createElement('div');
    handle.className = 'co-heading';
    handle.tabIndex = 0;
    handle.title = t('overtureMoveHelp');
    handle.setAttribute('aria-label', t('overtureMoveHelp'));
    const grip = document.createElement('span');
    grip.className = 'co-grip';
    grip.textContent = '⠿';
    grip.setAttribute('aria-hidden', 'true');
    const heading = document.createElement('strong');
    heading.textContent = t('overtureHeading');
    handle.append(heading, grip);
    button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('loadArea');
    button.title = t('loadAreaTitle');
    button.className = 'co-load';
    status = document.createElement('span');
    status.className = 'co-status';
    status.hidden = true;
    status.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'co-actions';
    addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.textContent = t('addBuilding');
    addButton.title = t('addBuildingTitle');

    addButton.hidden = true;
    addButton.addEventListener('click', addSelected);
    clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = t('removeOverlay');

    clearButton.hidden = true;
    clearButton.addEventListener('click', clearSnapshot);
    actions.append(button, addButton, clearButton);
    const attribution = document.createElement('div');
    attribution.className = 'co-attribution';
    const osmCredit = document.createElement('a');
    osmCredit.href = 'https://www.openstreetmap.org/copyright';
    osmCredit.target = '_blank';
    osmCredit.rel = 'noopener noreferrer';
    osmCredit.textContent = '© OpenStreetMap contributors';
    const providerCredit = document.createElement('span');
    providerCredit.textContent = ' · Overture Maps Foundation · Microsoft ML Buildings · Google Open Buildings · ';
    const licenses = document.createElement('a');
    licenses.href = 'https://docs.overturemaps.org/attribution/';
    licenses.target = '_blank';
    licenses.rel = 'noopener noreferrer';
    licenses.textContent = t('dataLicenses');
    attribution.append(osmCredit, providerCredit, licenses);
    control.append(handle, actions, status, attribution);
    document.body.appendChild(control);
    control.style.display = enabled ? 'grid' : 'none';
    makeDraggable(handle);
    requestAnimationFrame(placeControl);
    document.querySelector('.main-map').addEventListener('click', pick, true);
    document.addEventListener('keydown', accept, true);
    document.addEventListener('cosmetics:add-building-result', event => {
      setStatus(event.detail.messageKey ? t(event.detail.messageKey) : event.detail.message);
      if (event.detail.ok && selected) {
        accepted.add(selected.id);
        selected = null;
        render();
      }
    });
    document.addEventListener('cosmetics:osm-buildings-changed', () => {
      if (!enabled || !snapshot.length) return;
      clearTimeout(osmRefreshTimer);
      osmRefreshTimer = setTimeout(() => {
        if (!enabled || !snapshot.length) return;
        blocked = hideExistingBuildings(snapshot.filter(item => !accepted.has(item.id) &&
          item.geometry.type === 'Polygon').map(item => ({
          key: item.key, ring: item.geometry.coordinates[0]
        })));
        render();
      }, 150);
    });
    button.addEventListener('click', loadSnapshot);
    // Redraw cached geometry as the iD map changes; this never fetches tiles.
    setInterval(() => {
      if (!enabled || !snapshot.length) return;
      const v = view();
      const key = v && [v.zoom, v.lat, v.lon, v.width, v.height].join('/');
      if (key && key !== lastView) {
        lastView = key;
        render();
      }
    }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
  CosmeticsPanels.subscribe('overtureEnabled', setEnabled);
  const boot = setInterval(() => {
    if (document.getElementById(BUTTON_ID)) clearInterval(boot);
    else setup();
  }, 1000);
}
