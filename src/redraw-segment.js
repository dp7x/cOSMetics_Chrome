// Redraw one edge of a simple closed way; preview stays out of iD's history.
globalThis.CosmeticsRedrawSegment = function(getContext, getID) {
  let session;
  const ns='http://www.w3.org/2000/svg';
  const notify=(key,active=!!session)=>document.dispatchEvent(new CustomEvent('cosmetics:redraw-state',{
    detail:JSON.stringify({key,active})
  }));
  const ready=c=>c?.editable?.()&&!c.inIntro?.()&&c.mode?.()?.id==='select';
  const close=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-10;
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const sign=n=>Math.abs(n)<1e-16?0:Math.sign(n);
  const on=(a,b,p)=>!sign(turn(a,b,p))&&[0,1].every(i=>p[i]>=Math.min(a[i],b[i])-1e-10&&p[i]<=Math.max(a[i],b[i])+1e-10);
  const flat=([x,y])=>[x,Math.log(Math.tan(Math.PI/4+y*Math.PI/360))*180/Math.PI];
  const validLoc=p=>p?.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
  function winding(ring) {
    let sum=0;
    for(let i=1;i<ring.length-2;i++)sum+=turn(ring[0],ring[i],ring[i+1]);
    return sign(sum);
  }
  function simpleRing(ring) {
    const n=ring.length-1;
    if(n<3||!winding(ring))return false;
    for(let i=0;i<n;i++){
      const a=ring[i],b=ring[i+1],prev=ring[(i+n-1)%n];
      if(close(a,b)||on(prev,a,b)||on(a,b,prev))return false;
      for(let j=i+2;j<n;j++){
        if(i===0&&j===n-1)continue;
        const c=ring[j],d=ring[j+1];
        if([0,1].some(k=>Math.max(a[k],b[k])+1e-10<Math.min(c[k],d[k])||Math.max(c[k],d[k])+1e-10<Math.min(a[k],b[k])))continue;
        if((sign(turn(a,b,c))*sign(turn(a,b,d))<0&&sign(turn(c,d,a))*sign(turn(c,d,b))<0)||
          on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return false;
      }
    }
    return true;
  }
  function shared(g,way,a,b) {
    return g.parentWays(a).some(w=>w.id!==way.id&&w.areAdjacent(a.id,b.id));
  }
  function stop(key) {
    const s=session;session=null;
    if(s){
      s.overlay?.remove();
      if(s.overlay)s.map.on('move.cosmeticsRedraw',null);
      s.c.on('enter.cosmeticsRedraw',null);
    }
    if(key)notify(key);
  }

  function cancel() {
    const s=session;
    if(!s)return;
    if(s.mode&&s.c.mode()===s.mode){
      // Leaving native draw mode rolls back to its original start graph.
      s.c.enter(s.api.modeSelect(s.c,[s.way.id]));
    } else stop('redrawCancelled');
  }

  function resume(s,index) {
    const {c,api,way,nodes}=s,g=c.graph();
    if(!ready(c)||c.selectedIDs().length!==1||c.selectedIDs()[0]!==way.id||
      g.hasEntity(way.id)!==way||nodes.some(n=>g.hasEntity(n.id)!==n)||
      g.parentRelations(way).length)return stop('redrawChanged');
    if(shared(g,way,nodes[index],nodes[index+1]))return notify('redrawShared');
    if(nodes.length>=(c.connection?.()?.maxWayNodes?.()??2000))return stop('redrawLimit');

    const ring=way.nodes.slice(0,-1),start=(index+1)%ring.length;
    const rotated=ring.slice(start).concat(ring.slice(0,start));
    stop();
    launch({c,api,way,startGraph:g,ring:rotated,removed:[]});
  }

  function launch({c,api,way,startGraph,ring,removed}) {
    // iD appends vertices just before the closing node. The last distinct
    // vertex is the departure point; the first vertex remains the target.
    const ids=[...ring,ring[0]];
    const mode=api.modeDrawArea(c,way.id,startGraph,'area');
    mode.isContinuing=true;
    const prepare=graph=>{
      let next=graph.replace(way.update({nodes:ids}));
      for(const id of removed)next=next.remove(graph.hasEntity(id));
      return next;
    };
    if(ids.some((id,i)=>id!==way.nodes[i])||ids.length!==way.nodes.length)c.perform(prepare);
    const seed=c.graph();
    session={c,api,way,mode,startGraph,ring,removed,ids};
    c.on('enter.cosmeticsRedraw',next=>{
      // Native drawing re-enters the same mode after a point or undo.
      if(next===mode)return;
      if(seed!==startGraph&&c.graph()===seed){
        c.pop(1);
        if(removed.length)c.perform(prepare,'cOSMetics: Remove area vertex');
      }
      stop(c.graph()===startGraph?'redrawCancelled':'redrawDone');
    });
    c.enter(mode);
    notify(removed.length?'redrawSteppedBack':'redrawDrawing');
  }

  function stepBack(s) {
    const {c,api,way,startGraph,ring,removed}=s;
    const id=ring.at(-1),g=c.graph(),node=g.hasEntity(id);
    const prev=g.hasEntity(ring.at(-2));
    if(!node||!prev||Object.keys(node.tags||{}).length||
      g.parentWays(node).some(w=>w.id!==way.id)||g.parentRelations(node).length||
      g.parentRelations(way).length)return notify('redrawProtectedPoint');
    const next=ring.slice(0,-1);
    const shape=ids=>[...ids,ids[0]].map(n=>flat(g.hasEntity(n).loc));
    const candidate=shape(next);
    if(!simpleRing(candidate)||winding(candidate)!==winding(shape(ring)))return notify('redrawCannotStepBack');

    // Let iD discard its temporary drawing state, then reopen at the previous
    // vertex using the same original graph for cancellation.
    stop();
    c.enter(api.modeSelect(c,[way.id]));
    if(c.graph()!==startGraph)return notify('redrawChanged');
    launch({c,api,way,startGraph,ring:next,removed:[...removed,id]});
  }

  document.addEventListener('cosmetics:redraw-cancel',cancel);
  document.addEventListener('cosmetics:redraw-toggle',()=>{
    if(session)return cancel();
    const c=getContext(),api=getID(),container=document.querySelector('.main-map');
    if(!c)return notify('redrawDisconnected');
    if(typeof api?.modeDrawArea!=='function'||typeof api?.modeSelect!=='function')return notify('redrawNativeUnavailable');
    if(!ready(c)||!container||typeof c.projection!=='function')return notify('redrawSelect');
    const ids=c.selectedIDs(),g=c.graph(),way=ids.length===1&&g.hasEntity(ids[0]);
    if(way?.type!=='way'||!way.isClosed?.()||!way.isArea?.()||g.parentRelations(way).length)return notify('redrawSelect');
    const nodes=way.nodes.map(id=>g.hasEntity(id)),limit=c.connection?.()?.maxWayNodes?.()??2000;
    if(nodes.length>=limit)return notify('redrawLimit');
    if(nodes.length<4||nodes.some(n=>n?.type!=='node'||!validLoc(n.loc))||
      new Set(way.nodes.slice(0,-1)).size!==nodes.length-1)return notify('redrawSelect');
    const longs=nodes.map(n=>n.loc[0]);
    if(Math.max(...longs)-Math.min(...longs)>=180||!simpleRing(nodes.map(n=>flat(n.loc))))return notify('redrawSelect');
    document.dispatchEvent(new CustomEvent('cosmetics:draw-building-cancel'));
    const overlay=document.createElementNS(ns,'svg');
    overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:7;cursor:crosshair;touch-action:none';
    overlay.setAttribute('aria-hidden','true');
    const edge=document.createElementNS(ns,'polyline'),dot=document.createElementNS(ns,'circle');
    for(const [key,value] of Object.entries({fill:'none',stroke:'#ffb300','stroke-width':5,'stroke-dasharray':'7 4'}))edge.setAttribute(key,value);
    for(const [key,value] of Object.entries({r:6,fill:'#ffb300',visibility:'hidden',stroke:'#fff','stroke-width':2}))dot.setAttribute(key,value);
    overlay.append(edge,dot);container.append(overlay);
    const map=c.map(),s=session={c,api,map,way,nodes,overlay};
    function nearest(e) {
      const box=overlay.getBoundingClientRect(),surface=c.surfaceRect(),p=[e.clientX-surface.left,e.clientY-surface.top];
      const points=nodes.map(n=>c.projection(n.loc));
      let best=null,dist=12;
      // The final entry duplicates the first vertex in a closed ring.
      for(let i=0;i<points.length-1;i++){
        const [a,b]=[points[i],points[i+1]];
        const d=Math.hypot(p[0]-a[0],p[1]-a[1]);
        if(d<dist){dist=d;best={index:i,points:[a,b].map(([x,y])=>[x+surface.left-box.left,y+surface.top-box.top])};}
      }
      return best;
    }
    overlay.addEventListener('pointermove',e=>{
      const pick=nearest(e);
      edge.setAttribute('points',pick?pick.points.map(p=>p.join(',')).join(' '):'');
      dot.setAttribute('visibility',pick?'visible':'hidden');
      if(pick){dot.setAttribute('cx',pick.points[0][0]);dot.setAttribute('cy',pick.points[0][1]);}
    });
    for(const type of ['pointerdown','pointerup','mousedown','mouseup','dblclick','wheel','contextmenu']){
      overlay.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();},{passive:false});
    }
    overlay.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      if(session!==s||e.button!==0||e.detail>1)return;
      const pick=nearest(e);if(pick)resume(s,pick.index);
    });
    map.on('move.cosmeticsRedraw',()=>stop('redrawCancelled'));
    c.on('enter.cosmeticsRedraw',()=>stop('redrawCancelled'));
    notify('redrawPick');
  });
  window.addEventListener('keydown',e=>{
    const s=session;
    if(s?.overlay&&e.key==='Escape'){
      e.preventDefault();e.stopImmediatePropagation();cancel();return;
    }
    if(!s?.mode||s.c.mode()!==s.mode||e.defaultPrevented||e.isComposing||
      !(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey||e.key.toLowerCase()!=='z'||
      e.composedPath().some(el=>el.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(el.tagName)))return;
    const drawn=s.c.graph().hasEntity(s.way.id);
    const cursor=s.mode.activeID?.();
    const committed=drawn?.nodes.filter(id=>id!==cursor);
    // iD still handles ordinary undo while there are newly drawn vertices.
    if(!committed||committed.length!==s.ids.length||committed.some((id,i)=>id!==s.ids[i]))return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!e.repeat)stepBack(s);
  },true);
};
