// MAIN-world adapter. Changes enter iD's own history; no direct API writes.
globalThis.CosmeticsFixerBridge = function (getContext, getAPI) {
  'use strict';
  const core = globalThis.CosmeticsFixerCore;
  let generation = 0;
  let cancelFocus = null;
  function editor() {
    const context = getContext();
    if (!context?.graph || !getAPI()?.modeSelect) throw new Error('Collegamento con iD non disponibile: ricarica la pagina.');
    if (context.inIntro?.()) throw new Error('Chiudi prima il tutorial di iD.');
    const mode = context.mode?.()?.id;
    if (mode && !['browse', 'select'].includes(mode)) throw new Error('Completa l’operazione in iD e chiudi il pannello di salvataggio prima di continuare.');
    return context;
  }
  function current(context, id) {
    const entity = context.graph().hasEntity(id);
    if (!entity || entity.visible === false) throw new Error('Oggetto non disponibile o eliminato. Puoi saltarlo.');
    return entity;
  }
  function load(context, id) {
    if (context.graph().hasEntity(id)) return Promise.resolve(current(context, id));
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, entity) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        error ? reject(error) : resolve(entity);
      };
      const timer = setTimeout(() => finish(new Error('Caricamento scaduto. Riprova o salta l’oggetto.')), 20000);
      try {
        context.loadEntity(id, (error, result) => {
          if (finished) return;
          if (error) { finish(new Error('Impossibile caricare l’oggetto: potrebbe essere eliminato o non raggiungibile.')); return; }
          if (!result?.data?.some(entity => entity.id === id)) return; // parent-relation callback
          try { finish(null, current(context, id)); } catch (failure) { finish(failure); }
        });
      } catch (failure) { finish(failure); }
    });
  }
  function moveBeforeSelection(context, entity, ticket) {
    const map = context.map();
    const configuredMinimum = Number(context.minEditableZoom?.());
    const minimumZoom = Number.isFinite(configuredMinimum) && configuredMinimum > 0 ? configuredMinimum : 16;
    return new Promise((resolve, reject) => {
      const eventName = `drawn.cosmeticsFixer${ticket}`;
      let finished = false, firstFrame, secondFrame;
      const finish = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        map.on(eventName, null);
        if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
        if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
        if (cancelFocus === cancel) cancelFocus = null;
        error ? reject(error) : resolve();
      };
      const cancel = () => finish(new Error('Navigazione annullata.'));
      const timer = setTimeout(() => finish(new Error('La mappa non ha completato il ridisegno. Premi Rileggi / seleziona per riprovare.')), 5000);
      cancelFocus = cancel;
      try {
        // Remove the old selection first. iD throttles full map redraws, so
        // selecting immediately after zoomTo briefly paints the new outline
        // over the previous background/projection.
        context.enter(getAPI().modeBrowse(context));
        map.on(eventName, event => {
          if (event?.full === false || finished || firstFrame !== undefined) return;
          if (map.zoom() < minimumZoom) { map.zoom(minimumZoom); return; }
          // Let the new map frame reach the screen before highlighting.
          firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => finish());
          });
        });
        map.zoomTo(entity);
        // Fitting a large way or relation may zoom out below iD's editing
        // threshold. Keep iD's chosen centre, but raise the zoom before the
        // completed frame is selected. Closer views are left at their zoom.
        if (map.zoom() < minimumZoom) map.zoom(minimumZoom);
      } catch (error) { finish(error); }
    });
  }
  document.addEventListener('cosmetics:fixer-request', async event => {
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    if (!request || typeof request.requestId !== 'string' || request.requestId.length > 100) return;
    const reply = result => document.dispatchEvent(new CustomEvent('cosmetics:fixer-result', {
      detail: JSON.stringify({ ...result, requestId: request.requestId })
    }));
    try {
      if (request.action === 'cancel') { generation++; cancelFocus?.(); reply({ ok: true }); return; }
      const id = core.normalizeID(request.id);
      if (!id) throw new Error('ID OSM non valido.');
      const context = editor();
      if (request.action === 'open') {
        cancelFocus?.();
        const ticket = ++generation;
        await load(context, id);
        if (ticket !== generation) throw new Error('Navigazione annullata.');
        editor();
        const filter = () => request.filter === true && core.inspect(current(context, id).tags,
          core.rules(request.searchText, request.setText)).mismatch.length > 0;
        if (filter()) {
          reply({ ok: true, id, filtered: true });
          return;
        }
        await moveBeforeSelection(context, current(context, id), ticket);
        if (ticket !== generation) throw new Error('Navigazione annullata.');
        editor();
        if (filter()) { reply({ ok: true, id, filtered: true }); return; }
        const entity = current(context, id);
        context.enter(getAPI().modeSelect(context, [id]));
        reply({ ok: true, id, tags: entity.tags || {} });
      } else if (request.action === 'read') {
        reply({ ok: true, id, tags: current(context, id).tags || {} });
      } else if (request.action === 'apply') {
        if (!context.selectedIDs?.().includes(id)) throw new Error('L’oggetto selezionato in iD è cambiato. Premi Rileggi / seleziona.');
        if (context.editable && !context.editable()) throw new Error('L’editor non consente modifiche in questo momento.');
        const entity = current(context, id);
        if (!request.expectedTags || !core.sameTags(entity.tags || {}, request.expectedTags)) {
          throw new Error('I tag sono cambiati dopo l’anteprima. Premi Rileggi / seleziona e controllali di nuovo.');
        }
        const rule = core.rules(request.searchText, request.setText);
        const plan = core.inspect(entity.tags, rule);
        if (!plan.canApply) throw new Error('La regola non corrisponde, presenta conflitti oppure non modifica alcun tag.');
        // Re-read inside the action as well; never replace geometry or members.
        context.perform(graph => {
          const live = graph.hasEntity(id);
          if (!live || !core.sameTags(live.tags, request.expectedTags)) throw new Error('Oggetto cambiato: rileggi i tag.');
          return graph.replace(live.update({ tags: plan.after }));
        }, rule.mode === 'remove' ? 'The Fixer: remove tags' : 'The Fixer: change tags');
        reply({ ok: true, id, tags: current(context, id).tags || {}, mode: rule.mode });
      } else throw new Error('Operazione non riconosciuta.');
    } catch (error) { reply({ ok: false, error: error.message || 'Operazione non riuscita.' }); }
  });
};
