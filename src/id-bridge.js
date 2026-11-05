// Runs in the page's MAIN world before iD starts. The OSM website keeps its
// editor context in a local variable, so capture it at construction time.
(() => {
  let context;
  globalThis.CosmeticsDrawBuilding?.(() => context, () => window.iD);
  globalThis.CosmeticsSimplifyBridge(() => context, () => window.iD);
  globalThis.CosmeticsFixerBridge(() => context, () => window.iD);
  document.addEventListener('cosmetics:grid-request', event => {
    if (!context) return;
    const reply = (status, extra = {}) => document.dispatchEvent(
      new CustomEvent('cosmetics:grid-result', { detail: JSON.stringify({ status, ...extra }) })
    );
    try {
      const request = JSON.parse(event.detail);
      const mode = context.mode?.()?.id;
      const layer = context.layers?.()?.layer('data');
      if (!['browse', 'select'].includes(mode) || context.inIntro?.() ||
          !context.editable?.() || !layer?.setFile || !layer.hasData || !layer.enabled) {
        return reply('unavailable');
      }
      const occupied = layer.hasData();
      if (request.action === 'probe') return reply('ready', { occupied });
      if (request.action !== 'show') return;
      if (occupied && request.replace !== true) return reply('occupied');
      const data = request.data;
      if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) ||
          data.features.length < 1 || data.features.length > 100) return reply('unavailable');
      layer.setFile('.geojson', JSON.stringify(data));
      layer.enabled(true);
      reply('shown');
    } catch {
      reply('unavailable');
    }
  });

  let watchingHistory = false;

  function inside(point, ring) {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  }

  function crosses(a, b, c, d) {
    const turn = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const abC = turn(a, b, c), abD = turn(a, b, d);
    const cdA = turn(c, d, a), cdB = turn(c, d, b);
    return abC * abD < 0 && cdA * cdB < 0;
  }

  function overlaps(a, b) {
    if (a.some(point => inside(point, b)) || b.some(point => inside(point, a))) return true;
    for (let i = 1; i < a.length; i++) {
      for (let j = 1; j < b.length; j++) {
        if (crosses(a[i - 1], a[i], b[j - 1], b[j])) return true;
      }
    }
    // Identical outlines can have all vertices on the boundary.
    return a.length === b.length && a.slice(0, -1).every(point =>
      b.slice(0, -1).some(other => point[0] === other[0] && point[1] === other[1]));
  }

  function bounds(ring) {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [x, y] of ring) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
    return box;
  }

  function existingBuildingOverlaps(ring) {
    const min = [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1]))];
    const max = [Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
    const graph = context.graph();
    return context.history().intersects(window.iD.geoExtent(min, max)).some(entity => {
      if (entity.type !== 'way' || !entity.tags.building || entity.tags.building === 'no' || !entity.isClosed()) return false;
      const nodes = graph.childNodes(entity);
      const outline = nodes.map(node => node.loc);
      return outline.length >= 4 && overlaps(ring, outline);
    });
  }

  function watchHistory() {
    if (watchingHistory || !context?.history) return;
    const history = context.history();
    if (!history?.on) return;
    watchingHistory = true;
    const changed = () => document.dispatchEvent(new CustomEvent('cosmetics:osm-buildings-changed'));
    history.on('merge.cosmeticsBuildings', changed);
    history.on('change.cosmeticsBuildings', changed);
  }

  document.addEventListener('cosmetics:check-buildings', event => {
    const candidates = event.detail?.candidates;
    const blocked = [];
    try {
      if (context && Array.isArray(candidates) && candidates.length) {
        watchHistory();
        const candidatesWithBounds = candidates.filter(item => Array.isArray(item.ring) && item.ring.length >= 4)
          .map(item => ({ ...item, box: bounds(item.ring) }));
        if (candidatesWithBounds.length) {
          const area = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
          for (const { box } of candidatesWithBounds) {
            area.minX = Math.min(area.minX, box.minX);
            area.minY = Math.min(area.minY, box.minY);
            area.maxX = Math.max(area.maxX, box.maxX);
            area.maxY = Math.max(area.maxY, box.maxY);
          }
          const graph = context.graph();
          const buildings = context.history().intersects(window.iD.geoExtent(
            [area.minX, area.minY], [area.maxX, area.maxY]))
            .filter(entity => entity.type === 'way' && entity.tags.building &&
              entity.tags.building !== 'no' && entity.isClosed())
            .map(entity => {
              try {
                const ring = graph.childNodes(entity).map(node => node.loc);
                if (ring.length < 4) return null;
                return { ring, box: bounds(ring) };
              } catch (_) { return null; }
            }).filter(Boolean);
          for (const item of candidatesWithBounds) {
            const box = item.box;
            if (buildings.some(other => {
              const b = other.box;
              return !(box.maxX < b.minX || box.minX > b.maxX || box.maxY < b.minY || box.minY > b.maxY) &&
                overlaps(item.ring, other.ring);
            })) blocked.push(item.key);
          }
        }
      }
    } catch (error) {
      console.warn('cOSMetics: OSM building check failed', error);
    }
    document.dispatchEvent(new CustomEvent('cosmetics:check-buildings-result', {
      detail: { blocked }
    }));
  });

  // Resolve geometry-only edits against the ways already loaded in iD.
  document.addEventListener('cosmetics:modified-node-parents', event => {
    const parents = [];
    try {
      const ids = event.detail?.ids;
      if (context && Array.isArray(ids)) {
        const graph = context.graph();
        const seen = new Set();
        for (const raw of ids.slice(0, 1000)) {
          if (!/^-?\d+$/.test(String(raw))) continue;
          const node = graph.hasEntity(`n${raw}`);
          if (!node) continue;
          for (const way of graph.parentWays(node)) {
            if (seen.has(way.id)) continue;
            seen.add(way.id);
            parents.push({ id: way.id, tags: { ...way.tags }, pointCount: new Set(way.nodes || []).size });
          }
        }
      }
    } catch (error) {
      console.warn('cOSMetics: cannot resolve modified node parents', error);
    }
    document.dispatchEvent(new CustomEvent('cosmetics:modified-node-parents-result', {
      detail: { parents }
    }));
  });

  // Count geometry nodes from the loaded graph, including relation member ways.
  document.addEventListener('cosmetics:geometry-points', event => {
    const points = Object.create(null);
    try {
      const ids = event.detail?.ids;
      if (context && Array.isArray(ids)) {
        const graph = context.graph();
        for (const id of ids) {
          if (!/^[nwr]-?\d+$/.test(String(id))) continue;
          const nodes = new Set();
          const seen = new Set();
          const pending = [id];
          while (pending.length) {
            const current = pending.pop();
            if (seen.has(current)) continue;
            seen.add(current);
            const entity = graph.hasEntity(current);
            if (!entity) continue;
            if (entity.type === 'node') nodes.add(entity.id);
            if (entity.type === 'way') for (const nodeId of entity.nodes || []) nodes.add(nodeId);
            if (entity.type === 'relation') for (const member of entity.members || []) pending.push(member.id);
          }
          points[id] = nodes.size;
        }
      }
    } catch (error) {
      console.warn('cOSMetics: cannot count geometry nodes', error);
    }
    document.dispatchEvent(new CustomEvent('cosmetics:geometry-points-result', { detail: { points } }));
  });

  // Use iD's own changeset field callback, so hashtags are saved as metadata.
  document.addEventListener('cosmetics:changeset-hashtag', event => {
    const reply = ok => document.dispatchEvent(new CustomEvent('cosmetics:changeset-hashtag-result', { detail: { ok } }));
    try {
      const panel = document.querySelector('.modal-section.changeset-editor');
      const hashtag = event.detail?.hashtag;
      const previous = event.detail?.previous;
      const valid = value => typeof value === 'string' &&
        (value === '' || /^#[\p{L}\p{M}\p{N}_-]{1,99}$/u.test(value));
      if (!panel || !context?.changeset || !valid(hashtag) || !valid(previous)) return reply(false);
      const currentTags = context.changeset.tags;
      const hashtags = [];
      const seen = new Set();
      for (const raw of (currentTags.hashtags || '').split(/[,;\s]+/).filter(Boolean)) {
        const item = raw.startsWith('#') ? raw : `#${raw}`;
        const key = item.toLowerCase();
        if (previous && previous.toLowerCase() !== hashtag.toLowerCase() && key === previous.toLowerCase()) continue;
        if (!seen.has(key)) { seen.add(key); hashtags.push(item); }
      }
      if (hashtag && !seen.has(hashtag.toLowerCase())) hashtags.push(hashtag);
      const value = hashtags.join(';');
      const maxLength = typeof context.maxCharsForTagValue === 'function' ? context.maxCharsForTagValue() : 255;
      if ([...value].length > maxLength) return reply(false);
      const getField = () => panel.querySelector('.wrap-form-field-hashtags')?.__data__;
      let field = getField();
      if (!field && !value) return reply(true);
      if (!field) {
        // iD hides optional fields until a value exists. Reveal its normal field
        // by updating the changeset and asking the comment editor to rerender.
        const commentInput = panel.querySelector('.form-field-comment textarea');
        if (!commentInput) return reply(false);
        context.changeset = context.changeset.update({ tags: { ...currentTags, hashtags: value } });
        commentInput.dispatchEvent(new Event('input', { bubbles: true }));
        field = getField();
        if (!field || typeof field.on !== 'function' || typeof field.on('change') !== 'function') {
          context.changeset = context.changeset.update({ tags: currentTags });
          commentInput.dispatchEvent(new Event('input', { bubbles: true }));
          return reply(false);
        }
      }
      const change = typeof field.on === 'function' && field.on('change');
      if (typeof change !== 'function') return reply(false);
      change.call(field, { hashtags: value || undefined }, false);
      reply(true);
    } catch (error) {
      console.warn('cOSMetics: cannot update the iD hashtag field', error);
      reply(false);
    }
  });

  function attach(api) {
    if (!api || typeof api.coreContext !== 'function') return api;
    const original = api.coreContext;
    const wrapped = function (...args) {
      const instance = original.apply(this, args);
      context = instance;
      document.documentElement.dataset.cosmeticsIdBridge = 'ready';
      return instance;
    };
    // iD exports an ES module namespace object whose members are read-only.
    // Proxy the global instead of assigning to api.coreContext.
    return new Proxy(api, {
      get(target, key) {
        return key === 'coreContext' ? wrapped : Reflect.get(target, key);
      }
    });
  }

  if (window.iD) {
    window.iD = attach(window.iD);
  } else {
    let api;
    Object.defineProperty(window, 'iD', {
      configurable: true,
      enumerable: true,
      get: () => api,
      set(value) {
        api = attach(value);
        // Restore the ordinary global immediately after iD has loaded.
        Object.defineProperty(window, 'iD', {
          configurable: true, enumerable: true, writable: true, value: api
        });
      }
    });
  }

  document.addEventListener('cosmetics:add-building', event => {
    const reply = (ok, messageKey) =>
      document.dispatchEvent(new CustomEvent('cosmetics:add-building-result', { detail: { ok, messageKey } }));
    try {
      if (!context || !window.iD?.osmNode || !window.iD?.osmWay) {
        throw new Error('bridgeUnavailable');
      }
      const ring = event.detail?.ring;
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 200 ||
          !ring.every(p => Array.isArray(p) && p.length === 2 &&
            Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
            Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85.05112878)) {
        throw new Error('invalidGeometry');
      }
      const points = ring.slice(0, -1);
      if (points.length < 3 || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
        throw new Error('ringNotClosed');
      }
      if (context.inIntro?.()) throw new Error('closeTutorial');
      if (existingBuildingOverlaps(ring)) {
        throw new Error('existingBuilding');
      }
      const source = event.detail?.source;
      const sourceTag = source === 'Microsoft ML Buildings' ? 'microsoft/BuildingFootprints' :
        source === 'Google Open Buildings' ? 'google/OpenBuildings' : null;
      if (!sourceTag) throw new Error('unknownSource');
      const nodes = points.map(loc => new window.iD.osmNode({ loc }));
      const way = new window.iD.osmWay({
        nodes: [...nodes.map(node => node.id), nodes[0].id],
        tags: { building: 'yes', source: sourceTag }
      });
      context.perform(graph => {
        for (const node of nodes) graph = graph.replace(node);
        return graph.replace(way);
      }, typeof event.detail?.annotation === 'string' ? event.detail.annotation : 'Add building from Overture');
      context.enter(window.iD.modeSelect(context, [way.id]).newFeature(true));
      reply(true, 'buildingCreated');
    } catch (error) {
      reply(false, error.message || 'buildingFailed');
    }
  });
})();
