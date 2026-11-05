// Shared, dependency-free parsing and tag transformations. No network or edits.
(() => {
  'use strict';
  const limit = 20000;
  function osmID(type, id) {
    const prefix = { node: 'n', way: 'w', relation: 'r' }[type];
    if (typeof id === 'number' && !Number.isSafeInteger(id)) return null;
    const text = String(id ?? '');
    return prefix && /^[1-9]\d{0,18}$/.test(text) ? prefix + text : null;
  }
  function normalizeID(value) {
    if (typeof value !== 'string') return null;
    if (/^[nwr][1-9]\d{0,18}$/.test(value)) return value;
    const match = /^(node|way|relation)\/([1-9]\d{0,18})$/.exec(value);
    return match ? osmID(match[1], match[2]) : null;
  }
  function parseList(data) {
    if (!data || typeof data !== 'object') throw new Error('Formato non riconosciuto: usa GeoJSON o JSON di Overpass.');
    let raw;
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      raw = data.features.map(f => normalizeID(f?.id) || normalizeID(f?.properties?.['@id']));
    } else if (Array.isArray(data.elements)) {
      raw = data.elements.map(e => osmID(e?.type, e?.id));
    } else throw new Error('Formato non riconosciuto: usa GeoJSON o JSON di Overpass.');
    if (raw.length > 100000) throw new Error('Il file contiene troppi elementi. Esporta una lista più piccola.');
    const ids = [...new Set(raw.filter(Boolean))];
    if (!ids.length) throw new Error('Nessun ID OSM valido trovato nel file.');
    if (ids.length > limit) throw new Error(`Massimo ${limit} oggetti per questa bozza.`);
    return { ids, ignored: raw.filter(id => !id).length, duplicates: raw.filter(Boolean).length - ids.length };
  }
  function parseTags(text) {
    if (typeof text !== 'string' || text.length > 32000) throw new Error('Testo dei tag non valido.');
    const result = [];
    const seen = new Set();
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line) continue;
      const equals = line.indexOf('=');
      if (equals < 1) throw new Error(`Riga ${index + 1}: scrivi chiave=valore.`);
      const key = line.slice(0, equals).trim(), value = line.slice(equals + 1).trim();
      if (!key || !value || /[\s=\x00-\x1f]/u.test(key) || /[\x00-\x1f]/u.test(value) || key.length > 255 || value.length > 255) {
        throw new Error(`Riga ${index + 1}: chiave o valore non valido (massimo 255 caratteri).`);
      }
      if (seen.has(key)) throw new Error(`Chiave ripetuta: ${key}.`);
      seen.add(key); result.push([key, value]);
    }
    if (result.length > 100) throw new Error('Massimo 100 tag per campo.');
    return result;
  }
  function rules(searchText, setText) {
    const search = parseTags(searchText), set = parseTags(setText);
    if (!search.length && set.length) throw new Error('Specifica prima almeno un tag da cercare.');
    return { search, set, mode: !search.length ? 'manual' : set.length ? 'fix' : 'remove' };
  }
  function inspect(tags, rule) {
    const before = Object.fromEntries(Object.entries(tags || {}));
    const after = Object.fromEntries(Object.entries(before));
    const mismatch = rule.search.filter(([k, v]) => before[k] !== v).map(([k]) => k);
    const searchKeys = new Set(rule.search.map(([k]) => k));
    const conflicts = rule.set.filter(([k, v]) => !searchKeys.has(k) && Object.hasOwn(before, k) && before[k] !== v).map(([k]) => k);
    if (!mismatch.length && !conflicts.length && rule.mode !== 'manual') {
      for (const [key] of rule.search) delete after[key];
      for (const [key, value] of rule.set) Object.defineProperty(after, key, { value, enumerable: true, writable: true, configurable: true });
    }
    const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(key => before[key] !== after[key]).map(key => ({ key, before: before[key] ?? null, after: after[key] ?? null }));
    return { before, after, mismatch, conflicts, changes, canApply: rule.mode !== 'manual' && !mismatch.length && !conflicts.length && !!changes.length };
  }
  function sameTags(a, b) {
    const keys = Object.keys(a || {}).sort(), other = Object.keys(b || {}).sort();
    return keys.length === other.length && keys.every((key, i) => key === other[i] && a[key] === b[key]);
  }
  const api = Object.freeze({ parseList, parseTags, rules, inspect, sameTags, normalizeID });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CosmeticsFixerCore = api;
})();
