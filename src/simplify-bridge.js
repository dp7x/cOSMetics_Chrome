// Main-world access to iD; preview is an overlay, apply is one history action.
globalThis.CosmeticsSimplifyBridge = function(getContext) {
  'use strict';
  const core=globalThis.CosmeticsSimplifyCore;
  const annotation='cOSMetics: semplifica geometria';
  let preview=null,lastUndo=null,serial=0,hooked=null,overlay=null,noticeTimer;
  const parentIDs=(graph,node)=>JSON.stringify([
    graph.parentWays(node).map(e=>e.id).sort(),graph.parentRelations(node).map(e=>e.id).sort()
  ]);
  function editor() {
    const c=getContext();
    if(!c?.graph||!c.history||!c.undo)throw new Error('Collegamento con iD non disponibile. Ricarica la pagina.');
    if(c.inIntro?.())throw new Error('Chiudi prima il tutorial di iD.');
    if(!['browse','select'].includes(c.mode?.()?.id))throw new Error('Completa l’operazione in iD o chiudi il pannello di salvataggio.');
    return c;
  }
  function snapshot(c) {
    const selected=c.selectedIDs();
    if(selected.length!==1)throw new Error('Seleziona una sola linea o un poligono.');
    const graph=c.graph(),way=graph.hasEntity(selected[0]);
    if(way?.type==='relation'&&way.tags?.type==='multipolygon')throw new Error('La selezione è un multipoligono: questa bozza semplifica i poligoni costituiti da una singola way.');
    if(way?.type!=='way'||!Array.isArray(way.nodes))throw new Error('Seleziona una linea o un poligono costituito da una way.');
    const parents=graph.parentRelations(way),closed=way.nodes[0]===way.nodes.at(-1);
    let inner=false;
    for(const relation of parents){
      if(relation.tags?.type==='boundary')throw new Error('I membri di relazioni boundary non sono supportati in questa bozza.');
      if(relation.tags?.type==='multipolygon'){
        const membership=relation.members.filter(m=>m.id===way.id);
        if(!closed||membership.length!==1||membership[0].role!=='inner')throw new Error('Questa bozza gestisce solo anelli inner chiusi dei multipoligoni; gli outer e gli anelli spezzati restano esclusi.');
        inner=true;
      }
    }
    const nodes=way.nodes.map(id=>graph.hasEntity(id));
    if(nodes.some(n=>!n||n.type!=='node'))throw new Error('La way non è completamente caricata. Carica i dati dell’area in iD.');
    const refs=nodes.map(node=>parentIDs(graph,node));
    return {way,nodes,refs,parents,inner,points:nodes.map(node=>({id:node.id,loc:node.loc,
      protected:Object.keys(node.tags||{}).length>0||graph.parentWays(node).some(w=>w.id!==way.id)||graph.parentRelations(node).length>0}))};
  }
  function matches(c,snap) {
    const graph=c.graph();
    const parents=graph.parentRelations(snap.way);
    return graph.hasEntity(snap.way.id)===snap.way&&snap.nodes.every((node,i)=>graph.hasEntity(node.id)===node&&parentIDs(graph,node)===snap.refs[i])&&
      parents.length===snap.parents.length&&parents.every(r=>snap.parents.includes(r));
  }
  function canUndo(c) {
    if(!lastUndo||c.history().undoAnnotation()!==annotation||c.graph().hasEntity(lastUndo.way.id)!==lastUndo.way)return false;
    const parents=c.graph().parentRelations(lastUndo.way);
    return parents.length===lastUndo.parents.length&&parents.every(r=>lastUndo.parents.includes(r))&&
      lastUndo.kept.every(n=>c.graph().hasEntity(n.id)===n)&&lastUndo.removed.every(id=>!c.graph().hasEntity(id));
  }
  function clear() {preview=null;overlay?.remove();overlay=null;}
  function info() {
    try {
      const c=editor();installHooks(c);
      if(preview&&(!matches(c,preview.snapshot)||c.selectedIDs().join(',')!==preview.snapshot.way.id))clear();
      const undo=canUndo(c);
      try {
        const selected=snapshot(c),closed=selected.way.nodes[0]===selected.way.nodes.at(-1);
        return {eligible:true,id:selected.way.id,count:selected.nodes.length-(closed?1:0),inner:selected.inner,canUndo:undo,token:preview?.token||null};
      } catch(error) {return {eligible:false,reason:error.message,canUndo:undo,token:null};}
    } catch(error) {clear();return {eligible:false,reason:error.message,canUndo:false,token:null};}
  }
  function notify() {
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>document.dispatchEvent(new CustomEvent('cosmetics:simplify-state',{detail:JSON.stringify(info())})),70);
  }
  function draw() {
    if(!preview)return;
    const c=getContext(),map=document.querySelector('.main-map');
    if(!map)return;
    if(!overlay){
      overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
      overlay.id='cosmetics-simplify-overlay';overlay.setAttribute('aria-hidden','true');
      overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;overflow:hidden';
      for(const [color,width,dash] of [['#1688cf','5','7 5'],['#ed47c1','3','']]) {
        const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');
        line.setAttribute('fill','none');line.setAttribute('stroke',color);line.setAttribute('stroke-width',width);
        line.setAttribute('stroke-linejoin','round');line.setAttribute('stroke-dasharray',dash);overlay.append(line);
      }
      map.append(overlay);
    }
    const surface=c.surfaceRect(),box=map.getBoundingClientRect();
    const coords=[preview.snapshot.nodes.map(n=>n.loc),preview.result.coordinates];
    coords.forEach((points,i)=>overlay.children[i].setAttribute('points',points.map(loc=>{
      const p=c.projection(loc);return `${p[0]+surface.left-box.left},${p[1]+surface.top-box.top}`;
    }).join(' ')));
  }
  function installHooks(c) {
    if(hooked===c)return;hooked=c;
    c.on('enter.cosmeticsSimplify',notify);
    c.history().on('change.cosmeticsSimplify',()=>{if(preview&&!matches(c,preview.snapshot))clear();notify();});
    c.map().on('move.cosmeticsSimplify',draw).on('drawn.cosmeticsSimplify',draw);
  }
  document.addEventListener('cosmetics:simplify-request',event=>{
    let request;try{request=JSON.parse(event.detail);}catch{return;}
    if(typeof request?.requestId!=='string')return;
    const reply=result=>document.dispatchEvent(new CustomEvent('cosmetics:simplify-result',{detail:JSON.stringify({...result,requestId:request.requestId})}));
    try {
      if(request.action==='status'){reply({ok:true,...info()});return;}
      if(request.action==='clear'){clear();reply({ok:true,...info()});return;}
      const c=editor();installHooks(c);
      if(request.action==='preview') {
        clear();
        const snap=snapshot(c),result=core.simplify(snap.points,Number(request.tolerance),{inner:snap.inner});
        if(!result.removed.length){reply({ok:true,noChanges:true,...info(),...result});return;}
        preview={snapshot:snap,result,token:String(++serial)};draw();
        reply({ok:true,...info(),...result,token:preview.token});
      } else if(request.action==='apply') {
        if(!preview||preview.token!==request.token)throw new Error('Calcola prima una nuova anteprima.');
        if(c.selectedIDs().join(',')!==preview.snapshot.way.id||!matches(c,preview.snapshot))throw new Error('La selezione o i dati sono cambiati. Ricalcola l’anteprima.');
        if(!c.editable()){
          const map=c.map(),minimum=c.minEditableZoom?.();
          if(Number.isFinite(minimum)&&map.zoom()<minimum)map.zoom(minimum);
          if(!c.editable())throw new Error('Lo stato dell’editor non consente modifiche in questo momento.');
        }
        const saved=preview, removed=saved.result.removed;
        c.perform(graph=>{
          if(!matches(c,saved.snapshot))throw new Error('I dati sono cambiati dopo l’anteprima.');
          graph=graph.replace(saved.snapshot.way.update({nodes:saved.result.ids}));
          for(const id of removed){
            const node=graph.hasEntity(id);
            if(!node||Object.keys(node.tags||{}).length||graph.parentWays(node).length||graph.parentRelations(node).length)throw new Error('Un nodo da rimuovere è ancora utilizzato: ricalcola l’anteprima.');
            graph=graph.remove(node);
          }
          return graph;
        },annotation);
        lastUndo={way:c.graph().hasEntity(saved.snapshot.way.id),kept:saved.result.ids.map(id=>c.graph().hasEntity(id)),removed,parents:saved.snapshot.parents};
        clear();reply({ok:true,applied:true,removedCount:removed.length,...info()});notify();
      } else if(request.action==='undo') {
        if(!canUndo(c))throw new Error('La semplificazione non è più l’ultima modifica. Usa la cronologia di iD per scegliere cosa annullare.');
        clear();c.undo();lastUndo=null;reply({ok:true,undone:true,...info()});notify();
      } else throw new Error('Operazione non riconosciuta.');
    } catch(error){clear();reply({ok:false,error:error.message,...info()});}
  });
};
