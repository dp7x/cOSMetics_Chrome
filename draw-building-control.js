// Group Overture and drawing controls in separate rows inside Bricks.
(() => {
  const t = key => chrome.i18n.getMessage(key);
  function attach() {
    const load = document.querySelector('#cosmetics-overture-toggle .co-load');
    if (!load) return false;
    const panel = load.closest('#cosmetics-overture-toggle');
    const heading=panel.querySelector('.co-heading');
    const title=heading.querySelector('strong');
    title.textContent='Bricks';
    const titles=document.createElement('div'),subtitle=document.createElement('small');
    title.replaceWith(titles);titles.append(title,subtitle);
    subtitle.textContent=t('bricksToolsSubtitle');subtitle.className='co-subtitle';
    const minimize=document.createElement('button');
    minimize.id='co-minimize';minimize.type='button';minimize.textContent='−';
    minimize.title=globalThis.CosmeticsUI.text('Riduci o espandi');
    minimize.setAttribute('aria-expanded','true');
    minimize.addEventListener('pointerdown',e=>e.stopPropagation());
    minimize.addEventListener('click',e=>{
      e.stopPropagation();
      const collapsed=panel.classList.toggle('co-collapsed');
      minimize.textContent=collapsed?'+':'−';
      minimize.setAttribute('aria-expanded',String(!collapsed));
    });
    heading.querySelector('.co-grip')?.remove();heading.append(minimize);
    const style=document.createElement('style');
    style.textContent=`
      #cosmetics-overture-toggle{font:13px/1.45 system-ui,sans-serif;border:1px solid #b9bec5;border-radius:10px;box-shadow:0 3px 20px #0004;overflow:hidden;--co-bg:#fff;--co-text:#202124;--co-muted:#626974;--co-button:#f4f6f8;--co-border:#aeb6c0}
      #cosmetics-overture-toggle .co-heading{padding:8px 10px;margin:-8px -8px 2px;background:#f2f5f8;color:inherit;display:flex;justify-content:space-between;gap:8px}
      #cosmetics-overture-toggle .co-heading strong{font-size:15px}
      #cosmetics-overture-toggle .co-subtitle{display:block;font-size:11px;font-weight:400;color:var(--co-muted)}
      #cosmetics-overture-toggle .co-tool-row{align-items:center}
      #cosmetics-overture-toggle .co-tool-label{font-size:11px;font-weight:600;color:var(--co-muted);flex:0 0 auto}
      #cosmetics-overture-toggle .co-tool-row + .co-tool-row{border-top:1px solid var(--co-border);padding-top:5px}
      #cosmetics-overture-toggle button{font:inherit;border-radius:5px;padding:7px 9px}
      #cosmetics-overture-toggle button.co-load{background:#146b49;border-color:#146b49;color:#fff}
      #cosmetics-overture-toggle button.co-load:hover{background:#125c3e}
      #cosmetics-overture-toggle #co-minimize{padding:2px 8px;align-self:center}
      #cosmetics-overture-toggle.co-collapsed>:not(.co-heading){display:none!important}
      @media(prefers-color-scheme:dark){
        #cosmetics-overture-toggle{--co-bg:#24282d;--co-text:#e8eaed;--co-muted:#b5bec9;--co-button:#363d46;--co-border:#74808e;border-color:#626974}
        #cosmetics-overture-toggle .co-heading{background:#30363e}
        #cosmetics-overture-toggle button.co-load{background:#217a55}
      }
    `;
    document.head.append(style);
    const status = document.createElement('span');
    const buttons = [
      ['rectangle', 'cosmetics-draw-building', 'drawBuilding', '4', 'cosmetics:draw-building-toggle'],
      ['ortho', 'cosmetics-draw-ortho', 'drawOrtho', '5', 'cosmetics:draw-ortho-toggle'],
      ['arc', 'cosmetics-draw-arc', 'drawArc', '6', 'cosmetics:draw-arc-toggle']
    ].map(([mode,id,label,key,event])=>{
      const button=document.createElement('button');
      button.type='button';button.id=id;
      button.addEventListener('click',()=>document.dispatchEvent(new CustomEvent(event)));
      return {mode,button,label,key};
    });
    function updateButtons(mode,curving=false) {
      for(const {mode:own,button,label,key} of buttons) {
        const active=own===mode || (own==='arc'&&curving);
        button.setAttribute('aria-pressed',String(active));
        button.textContent=active?t('drawCancel'):t(label)+(key?' ('+key+')':'');
        button.title=active?'Esc':button.textContent;
        if(key||active)button.setAttribute('aria-keyshortcuts',active?'Escape':key);
        else button.removeAttribute?.('aria-keyshortcuts');
      }
    }
    updateButtons();
    status.className='co-status';
    status.setAttribute('role','status');
    status.hidden=true;
    function labelRow(row,text){
      const label=document.createElement('span');
      label.className='co-tool-label';
      label.textContent=text;
      row.classList.add('co-tool-row');
      row.setAttribute('role','group');
      row.setAttribute('aria-label',label.textContent);
      row.prepend(label);
    }
    const overtureRow=load.parentElement;
    const drawingRow=document.createElement('div');
    drawingRow.className='co-actions';
    labelRow(overtureRow,'Overture');
    labelRow(drawingRow,t('bricksDrawingGroup'));
    drawingRow.append(...buttons.map(item=>item.button));
    overtureRow.after(drawingRow);
    panel.append(status);
    load.addEventListener('click', cancel, true);
    function cancel() { document.dispatchEvent(new CustomEvent('cosmetics:draw-building-cancel')); }
    new MutationObserver(() => { if (panel.style.display === 'none') cancel(); })
      .observe(panel,{attributes:true,attributeFilter:['style']});
    // Keep the tagging reminder visible independently of Overture redraws.
    document.addEventListener('cosmetics:add-building-result', event => {
      let result;
      try { result = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail; }
      catch { return; }
      if (result?.ok !== true) return;
      status.textContent = t('drawCreated');
      status.hidden = !status.textContent;
    });
    document.addEventListener('cosmetics:draw-building-state',e=>{
      let state;
      try { state=JSON.parse(e.detail); } catch { return; }
      updateButtons(state.active?state.mode:undefined,state.curving);
      status.textContent=t(state.key);
      status.hidden=!status.textContent;
    });
    return true;
  }
  if (!attach()) {
    const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
})();
