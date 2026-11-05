// Attach Draw beside the existing Bricks load control, without rebuilding Overture.
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
    subtitle.textContent=t('captionOverture');subtitle.className='co-subtitle';
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
    const button = document.createElement('button'), status = document.createElement('span');
    button.type = 'button';
    button.id = 'cosmetics-draw-building';
    button.textContent = t('drawBuilding') + ' (4)';
    button.title = t('drawBuilding') + ' (4)';
    button.setAttribute('aria-keyshortcuts','4');
    button.setAttribute('aria-pressed','false');
    status.className = 'co-status';
    status.setAttribute('role','status');
    status.hidden = true;
    load.after(button);
    panel.append(status);
    button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('cosmetics:draw-building-toggle')));
    load.addEventListener('click', cancel, true);
    function cancel() { document.dispatchEvent(new CustomEvent('cosmetics:draw-building-cancel')); }
    new MutationObserver(() => { if (panel.style.display === 'none') cancel(); })
      .observe(panel,{attributes:true,attributeFilter:['style']});
    document.addEventListener('cosmetics:draw-building-state',e=>{
      let state;
      try { state=JSON.parse(e.detail); } catch { return; }
      button.setAttribute('aria-pressed',String(!!state.active));
      button.textContent=t(state.active?'drawCancel':'drawBuilding') + (state.active ? '' : ' (4)');
      button.title = state.active ? 'Esc' : t('drawBuilding') + ' (4)';
      button.setAttribute('aria-keyshortcuts', state.active ? 'Escape' : '4');
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
