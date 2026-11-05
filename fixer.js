// Local prototype: the imported file is a work list, never an upload payload.
(() => {
  'use strict';
  const tx = globalThis.CosmeticsUI.text;
  const core = globalThis.CosmeticsFixerCore;
  let host, ui, enabled = false, sequence = 0, epoch = 0, busy = false;
  let reviewView = false;
  let ids = [], index = 0, current = null, running = false, reviewing = false;
  const pending = new Map();
  // iD has capturing keyboard shortcuts. Shadow DOM retargets inputs to the
  // host, so shield this panel before those document-level handlers run.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, event => {
      if (host && event.composedPath().includes(host)) event.stopImmediatePropagation();
    }, true);
  }
  document.addEventListener('cosmetics:fixer-result', event => {
    let result;
    try { result = JSON.parse(event.detail); } catch { return; }
    const request = pending.get(result.requestId);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(result.requestId);
    result.ok ? request.resolve(result) : request.reject(new Error(result.error));
  });
  function bridge(action, detail = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `fixer-${Date.now()}-${++sequence}`;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('iD non risponde. Ricarica l’editor dopo aver salvato le tue modifiche.')); }, 25000);
      pending.set(requestId, { resolve, reject, timer });
      document.dispatchEvent(new CustomEvent('cosmetics:fixer-request', { detail: JSON.stringify({ ...detail, action, requestId }) }));
    });
  }
  function message(text, error = false) {
    ui.status.textContent = tx(text); ui.status.classList.toggle('error', error);
  }
  function getRule() { return core.rules(ui.search.value, ui.set.value); }
  function plan() { return current ? core.inspect(current.tags, getRule()) : null; }
  function update() {
    if (!ui) return;
    let rule, assessment, invalid = '';
    try { rule = getRule(); assessment = plan(); } catch (error) { invalid = error.message; }
    ui.progress.textContent = ids.length ? (index >= ids.length ? `Elenco completato · ${ids.length} oggetti` : `Oggetto ${index + 1} di ${ids.length}`) : 'Nessun elenco caricato';
    ui.target.textContent = current ? current.id : (ids[index] || '—');
    ui.tags.textContent = current ? Object.entries(current.tags).map(([k, v]) => `${k}=${v}`).join('\n') || '(nessun tag)' : '';
    if(!current||!Object.keys(current.tags).length)ui.tags.textContent=tx(ui.tags.textContent);
    ui.mode.textContent = invalid || (rule?.mode === 'remove' ? 'Rimozione dei tag cercati' : rule?.mode === 'fix' ? 'Sostituzione dei tag' : 'Revisione manuale');
    ui.preview.textContent = invalid || (!current ? '' : rule.mode === 'manual' ? 'Modalità manuale: modifica l’oggetto in iD, poi premi Avanti oppure premi Salta per passare al successivo.' :
      assessment.mismatch.length ? `Tag cercati non corrispondenti: ${assessment.mismatch.join(', ')}. Controlla l’oggetto o premi Salta.` :
      assessment.conflicts.length ? `Valori di destinazione già presenti e diversi: ${assessment.conflicts.join(', ')}. Modifica manualmente o premi Salta.` :
      assessment.changes.length ? assessment.changes.map(c => `${c.key}: ${c.before ?? tx('(assente)')} → ${c.after ?? tx('(rimuovi)')}`).join('\n') : 'La regola non produce modifiche.');
    ui.action.textContent = rule?.mode === 'remove' ? 'Rimuovi e avanti' : rule?.mode === 'fix' ? 'Correggi e avanti' : 'Avanti';
    ui.action.disabled = busy || !running || !current || !!invalid || (rule.mode !== 'manual' && !assessment.canApply);
    ui.start.textContent = index >= ids.length && ids.length ? 'Elenco completato' : 'Avvia revisione';
    ui.start.disabled = busy || !ids.length || index >= ids.length || !!invalid || running;
    ui.skip.disabled = busy || !running || index >= ids.length;
    ui.refresh.disabled = busy || !running || index >= ids.length;
    ui.previous.disabled = busy || !ids.length || index === 0;
    ui.start.hidden = running || busy;
    ui.config.hidden = reviewView;
    ui.review.hidden = !reviewView;
    ui.edit.hidden = !reviewView;
    ui.mode.hidden = reviewView;
    ui.edit.disabled = busy;
    ui.file.disabled = busy || running;
    ui.search.disabled = busy || running; ui.set.disabled = busy || running;
    for(const key of ['progress','mode','preview','action','start'])ui[key].textContent=tx(ui[key].textContent);
    ui.host.dataset.index = String(index); ui.host.dataset.count = String(ids.length);
  }
  async function openCurrent({ review = false } = {}) {
    const ticket = ++epoch;
    reviewing = review;
    current = null;
    if (index >= ids.length) {
      running = false; busy = false; message('Elenco completato.'); update(); return;
    }
    busy = true; update();
    try {
      const rule = getRule();
      while (index < ids.length) {
        message(`Verifica di ${ids[index]}…`);
        const result = await bridge('open', { id: ids[index], filter: !review && rule.mode !== 'manual',
          searchText: ui.search.value, setText: ui.set.value });
        if (ticket !== epoch) return;
        if (result.filtered) {
          index++; update();
          continue;
        }
        current = { id: result.id, tags: result.tags };
        message(review ? 'Revisione di un oggetto precedente: i tag possono essere già corretti.' : 'Oggetto selezionato in iD. Controllalo prima di procedere.');
        return;
      }
      running = false;
      message('Elenco completato: nessun altro oggetto corrisponde ai tag cercati.');
    } catch (error) { if (ticket === epoch) message(error.message, true); }
    finally { if (ticket === epoch) { busy = false; update(); } }
  }
  function advance() {
    index++; current = null; return openCurrent();
  }
  function previous() {
    if (busy || index === 0 || !ids.length) return;
    index--; running = true; current = null;
    return openCurrent({ review: true });
  }
  async function apply() {
    if (busy || !current || !running) return;
    const rule = getRule();
    if (rule.mode === 'manual') { await advance(); return; }
    if (!plan().canApply) return;
    const ticket = epoch;
    busy = true; update(); message('Applicazione della modifica…');
    try {
      await bridge('apply', { id: current.id, expectedTags: current.tags, searchText: ui.search.value, setText: ui.set.value });
      if (ticket !== epoch) return;
      busy = false;
      await advance();
    } catch (error) { if (ticket === epoch) { busy = false; current = null; message(error.message, true); update(); } }
  }
  function leaveReview() {
    epoch++; running = false; busy = false; current = null; reviewView = false;
    bridge('cancel').catch(() => {});
    message('Modifica la ricerca e avvia la revisione dalla posizione corrente.'); update();
  }
  function reset() {
    epoch++;
    running = false; busy = false; reviewing = false; current = null;
    ids = []; index = 0; reviewView = false;
    bridge('cancel').catch(() => {});
    ui.search.value = ''; ui.set.value = ''; ui.file.value = ''; ui.filename.textContent = '';
    ui.tagdetails.open = false;
    ui.config.hidden = false;
    message('Form azzerata. Puoi caricare un nuovo elenco.');
    update();
  }
  async function importFile(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    const ticket = ++epoch;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Il file non può superare 20 MB.');
      const data = JSON.parse(await file.text());
      if (ticket !== epoch) return;
      const list = core.parseList(data);
      ids = list.ids; index = 0;
      const note = `${ids.length} oggetti caricati. Configura la regola indicando i tag oppure lascia entrambi i campi vuoti per la revisione manuale.`;
      epoch++; current = null; running = false; reviewView = false;
      ui.filename.textContent = file.name; message(note); update();
    } catch (error) { if (ticket === epoch) message(`File non caricato: ${tx(error.message)}`, true); }
    finally { input.value = ''; }
  }
  function makePanel() {
    if (host || !document.querySelector('.main-map')) return;
    host = document.createElement('div'); host.id = 'cosmetics-fixer-host';
    host.style.cssText = 'position:fixed;top:80px;right:16px;width:370px;max-width:calc(100vw - 24px);z-index:1100;color-scheme:light dark';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{font:13px/1.45 system-ui,sans-serif;color:#202124}*{box-sizing:border-box}
      .panel{background:#fff;border:1px solid #b9bec5;border-radius:10px;box-shadow:0 3px 20px #0004;overflow:hidden}
      header{padding:10px 12px;background:#f2f5f8;display:flex;align-items:center;justify-content:space-between;cursor:move;touch-action:none}
      header strong{font-size:15px}.panel-subtitle{display:block;font-size:11px;font-weight:400}header span{font-size:11px;color:#626974}header button{margin:0;padding:3px 8px}
      main{padding:12px;max-height:calc(100vh - 190px);overflow:auto}p{margin:0 0 10px}label{display:block;font-weight:600;margin:10px 0 4px}
      textarea,input{font:inherit;color:inherit;width:100%;background:#fff}textarea{padding:7px;border:1px solid #aeb6c0;border-radius:5px;min-height:64px;resize:vertical;font-family:monospace}
      button{font:inherit;border:1px solid #aeb6c0;border-radius:5px;background:#f4f6f8;color:inherit;cursor:pointer;padding:7px 9px}button:disabled{opacity:.5;cursor:default}
      .row{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.primary{background:#146b49;color:#fff;border-color:#146b49;flex:1}
      summary{cursor:pointer;font-weight:600}small,.muted{color:#626974}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0 10px;font:12px/1.5 monospace}
      #fx-tags{max-height:115px;overflow:auto;background:#f6f7f8;padding:7px;border-radius:4px}#fx-preview{border-left:3px solid #5385b7;padding-left:8px}
      [hidden]{display:none!important}.mode{margin:10px 0 0;font-weight:600}#fx-tagdetails{margin-top:8px}#fx-status{margin:8px 0 0;overflow-wrap:anywhere}.error{color:#ad2222}#fx-filename{display:block;overflow-wrap:anywhere;margin-top:5px}
      @media(prefers-color-scheme:dark){:host{color:#e8eaed}.panel{background:#24282d;border-color:#626974}header{background:#30363e}header span,small,.muted{color:#b5bec9}textarea,input{background:#1c2025}button{background:#363d46;border-color:#74808e}.primary{background:#217a55}#fx-tags{background:#191d22}.error{color:#ffaaaa}}
      textarea{line-height:24px;padding:0 8px;min-height:98px;background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 23px,var(--fx-rule-line,#d5dce4) 23px,var(--fx-rule-line,#d5dce4) 24px);background-origin:content-box}
      @media(prefers-color-scheme:dark){textarea{--fx-rule-line:#4c5560}}
    </style><section class="panel" aria-label="Sensei"><header tabindex="0" title="Trascina per spostare il pannello"><div><strong>Sensei</strong><small class="panel-subtitle">Revisione tag</small></div><button id="fx-minimize" type="button" aria-expanded="true" title="Riduci o espandi">−</button></header><main>
      <section id="fx-config" aria-label="Preparazione">
      <label for="fx-file">Elenco da esaminare</label><input id="fx-file" type="file" accept=".json,.geojson,application/json,application/geo+json"><small id="fx-filename"></small>
      <label for="fx-search">Tag da cercare / rimuovere · uno per riga</label><textarea id="fx-search" rows="4" spellcheck="false" placeholder="chiave=valore&#10;altra_chiave=altro_valore"></textarea>
      <label for="fx-set">Tag da impostare · uno per riga</label><textarea id="fx-set" rows="4" spellcheck="false" placeholder="chiave=valore&#10;altra_chiave=altro_valore"></textarea>
      <div class="row"><button id="fx-reset" type="button" title="Svuota elenco e campi.">Azzera</button></div>
      <small>Tutti i tag cercati devono corrispondere. Lascia vuoti entrambi i campi per la revisione manuale.</small></section>
      <p id="fx-mode" class="mode"></p>
      <section id="fx-review" aria-label="Revisione" hidden>
      <p id="fx-progress" class="muted"></p><strong id="fx-target"></strong><pre id="fx-preview"></pre>
      <div class="row"><button id="fx-action" type="button" class="primary">Avanti</button><button id="fx-skip" type="button">Salta</button></div>
      <div class="row"><button id="fx-previous" type="button">Precedente</button><button id="fx-refresh" type="button" title="Rilegge i tag correnti e seleziona nuovamente l’oggetto in iD">Rileggi oggetto</button></div>
      <details id="fx-tagdetails"><summary>Tutti i tag dell’oggetto</summary><pre id="fx-tags"></pre></details>
      </section>
      <div class="row controls"><button id="fx-start" type="button" class="primary">Avvia revisione</button><button id="fx-edit" type="button">Modifica ricerca</button></div>
      <p id="fx-status" role="status" aria-live="polite"></p>
    </main></section>`;
    globalThis.CosmeticsUI.panel(shadow);
    document.body.append(host);
    const node = key => shadow.getElementById(`fx-${key}`);
    ui = Object.fromEntries(['search','set','progress','target','tags','preview','action','start','skip','refresh','previous','reset','file','status','filename','config','review','edit','tagdetails','mode'].map(key => [key, node(key)]));
    ui.host = host;
    for (const type of ['keydown','keyup','keypress']) host.addEventListener(type, event => event.stopPropagation());
    for (const type of ['pointerdown','mousedown','click','dblclick']) host.addEventListener(type, event => event.stopPropagation());
    ui.file.addEventListener('change', importFile);
    ui.search.addEventListener('input', update); ui.set.addEventListener('input', update);
    ui.start.addEventListener('click', () => { running = true; reviewView = true; openCurrent(); });
    ui.edit.addEventListener('click', () => {
      if (busy) return;
      leaveReview(); ui.search.focus();
    });
    ui.refresh.addEventListener('click', () => openCurrent({ review: reviewing }));
    ui.previous.addEventListener('click', previous);
    ui.reset.addEventListener('click', reset);
    ui.skip.addEventListener('click', () => advance());
    ui.action.addEventListener('click', () => apply().catch(error => message(error.message, true)));
    node('minimize').addEventListener('click', event => {
      const main = shadow.querySelector('main'); main.hidden = !main.hidden;
      event.currentTarget.textContent = main.hidden ? '+' : '−'; event.currentTarget.setAttribute('aria-expanded', String(!main.hidden));
    });
    const heading = shadow.querySelector('header');
    heading.addEventListener('pointerdown', event => {
      if (event.target.closest('button') || event.button !== 0) return;
      const bounds = host.getBoundingClientRect(), x = event.clientX, y = event.clientY;
      heading.setPointerCapture(event.pointerId);
      const move = next => {
        host.style.right = 'auto';
        host.style.left = `${Math.max(0, Math.min(innerWidth - host.offsetWidth, bounds.left + next.clientX - x))}px`;
        host.style.top = `${Math.max(0, Math.min(innerHeight - 45, bounds.top + next.clientY - y))}px`;
      };
      const end = () => { heading.removeEventListener('pointermove', move); heading.removeEventListener('pointerup', end); heading.removeEventListener('pointercancel', end); };
      heading.addEventListener('pointermove', move); heading.addEventListener('pointerup', end); heading.addEventListener('pointercancel', end);
    });
    message('Carica un GeoJSON o JSON di Overpass. Il file sarà letto solo nel browser.'); update();
    host.hidden = !enabled;
  }
  function setEnabled(value) {
    enabled = value === true;
    if (enabled) makePanel();
    if (host) { host.hidden = !enabled; if (!enabled && running) leaveReview(); }
  }
  CosmeticsPanels.subscribe('fixerEnabled', setEnabled);
  const observer = new MutationObserver(() => { if (enabled && !host) makePanel(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
