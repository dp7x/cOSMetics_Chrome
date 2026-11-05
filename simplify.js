(() => {
  'use strict';
  const tx=globalThis.CosmeticsUI.text;
  let host,ui,enabled=false,token=null,state={},busy=false,live=false,dirty=false;
  let seq=0,previewTimer,prefsTimer,poll,uiEpoch=0;
  const pending=new Map();
  document.addEventListener('cosmetics:simplify-result',event=>{
    let r;try{r=JSON.parse(event.detail);}catch{return;}
    const item=pending.get(r.requestId);if(!item)return;
    clearTimeout(item.timer);pending.delete(r.requestId);item.resolve(r);
  });
  document.addEventListener('cosmetics:simplify-state',event=>{
    if(!enabled||!ui)return;try{accept(JSON.parse(event.detail));}catch{}
  });
  function bridge(action,extra={}) {
    return new Promise(resolve=>{
      const requestId=`simplify-${Date.now()}-${++seq}`;
      const timer=setTimeout(()=>{pending.delete(requestId);resolve({ok:false,error:'iD non risponde. Riprova dopo aver ricaricato la pagina.'});},15000);
      pending.set(requestId,{resolve,timer});
      document.dispatchEvent(new CustomEvent('cosmetics:simplify-request',{detail:JSON.stringify({...extra,requestId,action})}));
    });
  }
  function say(text,error=false){ui.status.textContent=tx(text);ui.status.classList.toggle('error',error);}
  function buttons(){
    if(!ui)return;
    ui.preview.disabled=busy||!state.eligible;
    ui.apply.disabled=busy||!token;
    ui.cancel.disabled=busy||(!token&&!state.canUndo);
    ui.cancel.title=tx(token?'Annulla anteprima':'Annulla ultima semplificazione');
    ui.range.disabled=busy;ui.number.disabled=busy;
  }
  function accept(next) {
    const changed=state.id!==next.id;
    state=next;
    if(token&&next.token!==token){token=null;ui.result.textContent='';}
    if(changed){live=false;clearTimeout(previewTimer);uiEpoch++;if(state.eligible)say('Premi Anteprima o 5.');}
    ui.selection.textContent=state.eligible?`${state.id} · ${state.count} nodi`:state.reason||'Seleziona una linea o un poligono.';
    if(!state.eligible){token=null;ui.result.textContent='';}
    ui.selection.textContent=tx(ui.selection.textContent);
    buttons();
  }
  async function status(){if(enabled&&ui&&!busy){const r=await bridge('status');if(enabled){r.ok?accept(r):say(r.error,true);}}}
  async function preview() {
    if(busy||!state.eligible)return;
    const tolerance=Number(ui.number.value);
    if(!Number.isFinite(tolerance)||tolerance<0.1||tolerance>10){say('Usa una tolleranza tra 0,1 e 10 metri.',true);return;}
    live=true;busy=true;token=null;buttons();say('Calcolo dell’anteprima…');
    const ticket=uiEpoch,r=await bridge('preview',{tolerance});
    if(ticket!==uiEpoch||!enabled){busy=false;buttons();return;}
    busy=false;
    if(!r.ok){token=null;say(r.error,true);accept({...r,token:null});return;}
    accept(r);token=r.token||null;
    const percent=Math.round(100*(r.beforeCount-r.afterCount)/r.beforeCount);
    ui.result.textContent=tx(`${r.beforeCount} → ${r.afterCount} nodi · −${percent}%`);
    ui.result.title=tx(`${r.protectedCount} nodi vincolati · scarto ${r.maxError.toFixed(3)} m`);
    say(r.noChanges?'Nessun nodo eliminabile con questa tolleranza.':'Anteprima pronta.');buttons();
  }
  async function apply() {
    if(!token||busy)return;
    busy=true;live=false;clearTimeout(previewTimer);buttons();
    const r=await bridge('apply',{token});busy=false;token=null;ui.result.textContent='';
    accept(r);say(r.ok?`Rimossi ${r.removedCount} nodi.`:r.error,!r.ok);
  }
  async function cancel() {
    if(busy)return;
    live=false;clearTimeout(previewTimer);busy=true;buttons();
    const action=token?'clear':'undo',r=await bridge(action);token=null;busy=false;ui.result.textContent='';
    accept(r);say(r.ok?(action==='clear'?'Anteprima annullata.':'Ultima semplificazione annullata.') :r.error,!r.ok);
  }
  function savePrefs(){
    clearTimeout(prefsTimer);prefsTimer=setTimeout(()=>chrome.storage.local.set({simplifyPreferences:{tolerance:Number(ui.number.value)}}),180);
  }
  function changeTolerance(source) {
    dirty=true;
    const value=Number(source.value);
    if(!Number.isFinite(value)||value<0.1||value>10){token=null;buttons();say('Usa una tolleranza tra 0,1 e 10 metri.',true);return;}
    ui.number.value=String(value);ui.range.value=String(value);savePrefs();
    token=null;ui.result.textContent='';bridge('clear');buttons();
    clearTimeout(previewTimer);if(live)previewTimer=setTimeout(preview,220);
  }
  // Synchronous status is needed before consuming the preview shortcut.
  function currentSelection() {
    const requestId=`simplify-key-${++seq}`;let response;
    const receive=event=>{try{const r=JSON.parse(event.detail);if(r.requestId===requestId)response=r;}catch{}};
    document.addEventListener('cosmetics:simplify-result',receive);
    document.dispatchEvent(new CustomEvent('cosmetics:simplify-request',{detail:JSON.stringify({action:'status',requestId})}));
    document.removeEventListener('cosmetics:simplify-result',receive);
    return response;
  }
  window.addEventListener('keydown',event=>{
    const inPanel=host&&event.composedPath().includes(host);
    const writing=event.composedPath().some(el=>['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable);
    if(enabled&&!writing&&!event.defaultPrevented&&!event.isComposing&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey){
      const key=event.key;
      if(key==='5'||(key==='0'&&token&&!busy&&!event.repeat)){
        const selected=currentSelection();
        if(selected?.ok&&selected.eligible&&(key==='5'||selected.token===token)){
          event.preventDefault();event.stopImmediatePropagation();accept(selected);
          if(key==='0')apply();
          else if(!event.repeat&&!busy)preview();
          return;
        }
      }
    }
    if(inPanel)event.stopImmediatePropagation();
  },true);
  function panel() {
    if(host||!document.querySelector('.main-map'))return;
    host=document.createElement('div');host.id='cosmetics-simplify-host';
    host.style.cssText=`position:fixed;left:${Math.min(320,Math.max(12,innerWidth-370))}px;bottom:24px;width:310px;max-width:calc(100vw - 24px);z-index:1101;color-scheme:light dark`;
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>
      :host{font:13px/1.45 system-ui,sans-serif;color:#202124}*{box-sizing:border-box}.panel{background:#fff;border:1px solid #b9bec5;border-radius:10px;box-shadow:0 3px 20px #0004;overflow:hidden}
      header{padding:8px 10px;background:#f2f5f8;display:flex;align-items:center;justify-content:space-between;cursor:move;touch-action:none}header strong{font-size:15px}.panel-subtitle{display:block;font-size:11px;font-weight:400}header button{padding:2px 8px}
      main{padding:10px;max-height:calc(100vh - 150px);overflow:auto}p{margin:0 0 9px}label{display:block;font-weight:600;margin-top:12px}.controls{display:flex;gap:9px;align-items:center;margin:6px 0}input[type=range]{min-width:0;flex:1}input[type=number]{width:74px;padding:5px;background:#fff;color:inherit;border:1px solid #aeb6c0;border-radius:4px}
      button{font:inherit;padding:7px 9px;border:1px solid #aeb6c0;border-radius:5px;cursor:pointer;background:#f4f6f8;color:inherit}button:disabled{opacity:.5;cursor:default}.primary{background:#146b49;border-color:#146b49;color:#fff}.row{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}pre{white-space:pre-wrap;font:12px/1.5 monospace}.muted,small{color:#626974}.error{color:#ad2222}summary{cursor:pointer}#sp-status{overflow-wrap:anywhere}.blue{color:#1688cf}.pink{color:#d92baa}
      @media(prefers-color-scheme:dark){:host{color:#e8eaed}.panel{background:#24282d;border-color:#626974}header{background:#30363e}input[type=number]{background:#1c2025}button{background:#363d46;border-color:#74808e}.primary{background:#217a55}.muted,small{color:#b5bec9}.error{color:#ffaaaa}}
    </style><section class="panel" aria-label="Ockham"><header title="Trascina per spostare"><div><strong>Ockham</strong><small class="panel-subtitle">Semplificatore di geometrie</small></div><button id="sp-minimize" type="button" aria-expanded="true" title="Riduci / espandi">−</button></header><main>
      <p id="sp-selection" class="muted">Seleziona una linea o un poligono.</p>
      <label for="sp-range">Tolleranza (m)</label><div class="controls"><input id="sp-range" type="range" min="0.1" max="10" step="0.1" value="0.5" aria-label="Tolleranza in metri"><input id="sp-number" type="number" min="0.1" max="10" step="0.1" value="0.5" aria-label="Tolleranza precisa in metri"></div>
      <pre id="sp-result"></pre><p><span class="blue">━ ━ Originale</span> · <span class="pink">━━ Proposta</span></p>
      <div class="row"><button id="sp-preview" type="button" title="Anteprima · 5" aria-keyshortcuts="5">Anteprima (5)</button><button id="sp-apply" type="button" class="primary" aria-keyshortcuts="0">Applica (0)</button><button id="sp-cancel" type="button">Annulla</button></div>
      <p id="sp-status" role="status" aria-live="polite"></p>
    </main></section>`;
    globalThis.CosmeticsUI.panel(shadow);
    document.body.append(host);const q=id=>shadow.getElementById('sp-'+id);
    ui=Object.fromEntries(['selection','range','number','preview','apply','cancel','result','status'].map(k=>[k,q(k)]));
    for(const type of ['keyup','keypress','pointerdown','mousedown','click','dblclick'])host.addEventListener(type,event=>event.stopPropagation());
    ui.range.addEventListener('input',()=>changeTolerance(ui.range));ui.number.addEventListener('input',()=>changeTolerance(ui.number));
    ui.preview.addEventListener('click',preview);ui.apply.addEventListener('click',apply);ui.cancel.addEventListener('click',cancel);
    q('minimize').addEventListener('click',event=>{const main=shadow.querySelector('main');main.hidden=!main.hidden;event.currentTarget.textContent=main.hidden?'+':'−';event.currentTarget.setAttribute('aria-expanded',String(!main.hidden));});
    const heading=shadow.querySelector('header');heading.addEventListener('pointerdown',event=>{
      if(event.target.closest('button')||event.button!==0)return;
      const box=host.getBoundingClientRect(),x=event.clientX,y=event.clientY;heading.setPointerCapture(event.pointerId);
      const move=e=>{host.style.bottom='auto';host.style.left=`${Math.max(0,Math.min(innerWidth-host.offsetWidth,box.left+e.clientX-x))}px`;host.style.top=`${Math.max(0,Math.min(innerHeight-45,box.top+e.clientY-y))}px`;};
      const end=()=>{for(const type of ['pointerup','pointercancel'])heading.removeEventListener(type,end);heading.removeEventListener('pointermove',move);};
      heading.addEventListener('pointermove',move);heading.addEventListener('pointerup',end);heading.addEventListener('pointercancel',end);
    });
    chrome.storage.local.get('simplifyPreferences',items=>{if(dirty)return;const p=items.simplifyPreferences;
      if(p&&Number.isFinite(p.tolerance)&&p.tolerance>=0.1&&p.tolerance<=10)ui.number.value=ui.range.value=String(p.tolerance);
    });
    say('Anteprima · 5');buttons();host.hidden=!enabled;
  }
  function setEnabled(value){
    enabled=value===true;uiEpoch++;
    if(enabled)panel();if(host)host.hidden=!enabled;
    clearInterval(poll);clearTimeout(previewTimer);
    if(enabled){status();poll=setInterval(status,900);}else{live=false;token=null;bridge('clear');}
  }
  CosmeticsPanels.subscribe('simplifyEnabled',setEnabled);
  const observer=new MutationObserver(()=>{if(enabled&&!host){panel();status();}});observer.observe(document.documentElement,{childList:true,subtree:true});
})();
