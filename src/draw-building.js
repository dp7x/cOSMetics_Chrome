// Main-world drawing session. Only the final click changes the iD graph.
globalThis.CosmeticsDrawBuilding = function(getContext, getID) {
  const ns = 'http://www.w3.org/2000/svg';
  let session;
  const status = key => document.dispatchEvent(new CustomEvent('cosmetics:draw-building-state', {
    detail: JSON.stringify({ key, active: !!session })
  }));
  function finish(key) {
    if (session) {
      const old = session;
      session = undefined;
      old.overlay.remove();
      old.context.map().on('move.cosmeticsDrawBuilding', null);
    }
    status(key);
  }
  function ready(c) {
    return c?.editable?.() && !c.inIntro?.() && ['browse', 'select'].includes(c.mode?.()?.id);
  }
  function square(a, p) {
    const dx = p[0] - a[0], dy = p[1] - a[1];
    const size = Math.hypot(dx, dy) / Math.SQRT2;
    if (size < 4) return;
    return { size, u: [(dx-dy)/(2*size),(dy+dx)/(2*size)], v: [(dx+dy)/(2*size),(dy-dx)/(2*size)] };
  }
  function shape(s, p) {
    const basis = s.basis || square(s.anchor, p);
    if (!basis) return;
    const { u, v, size } = basis, a = s.anchor;
    let w = size, h = size;
    if (s.basis) {
      const dx = p[0]-a[0], dy = p[1]-a[1];
      const x = dx*u[0]+dy*u[1], y = dx*v[0]+dy*v[1];
      // The initial diagonal is x=y. Use a small dead band to avoid flicker.
      if (Math.abs(x-y) > 3) s.axis = x > y ? 'u' : 'v';
      if (s.axis === 'u') w = Math.max(4,x);
      if (s.axis === 'v') h = Math.max(4,y);
    }
    const corner = (x,y) => [a[0]+x*u[0]+y*v[0],a[1]+x*u[1]+y*v[1]];
    return [a,corner(w,0),corner(w,h),corner(0,h)];
  }
  // Snap in screen pixels, but commit the original OSM node IDs.
  const radius = 14;
  const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
  function nearest(s,p) {
    const c=s.context, id=getID();
    const a=s.invert([p[0]-radius,p[1]-radius]), b=s.invert([p[0]+radius,p[1]+radius]);
    if (!c.history || !id?.geoExtent || !c.graph) return;
    const graph=c.graph();
    let best, limit=radius, wallBest, wallLimit=radius;
    for (const way of c.history().intersects(id.geoExtent([Math.min(a[0],b[0]),Math.min(a[1],b[1])],[Math.max(a[0],b[0]),Math.max(a[1],b[1])]))) {
      if (way.type!=='way'||!way.tags.building||way.tags.building==='no'||
          way.nodes.length<4||way.nodes[0]!==way.nodes.at(-1)) continue;
      const nodes=way.nodes.slice(0,-1).map(n=>graph.hasEntity(n));
      if (nodes.some(n=>!n?.loc)||new Set(way.nodes.slice(0,-1)).size!==nodes.length) continue;
      const points=nodes.map(n=>s.project(n.loc));
      const area=points.reduce((sum,[x,y],i)=>{
        const [nx,ny]=points[(i+1)%points.length];
        return sum+x*ny-y*nx;
      },0);
      if (!Number.isFinite(area)||Math.abs(area)<1) continue;
      if(typeof id.actionAddMidpoint==='function'){
        points.forEach((start,i)=>{
          const j=(i+1)%points.length,end=points[j];
          const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy);
          if(length<8)return;
          const t=((p[0]-start[0])*dx+(p[1]-start[1])*dy)/(length*length);
          if(t*length<4||(1-t)*length<4)return;
          const xy=[start[0]+t*dx,start[1]+t*dy],d=distance(p,xy);
          if(d>=wallLimit)return;
          wallLimit=d;
          wallBest={way,xy,edge:[nodes[i],nodes[j]],walls:[
            {node:nodes[i],xy:start,side:Math.sign(area)},
            {node:nodes[j],xy:end,side:-Math.sign(area)}
          ]};
        });
      }
      points.forEach((xy,i)=>{
        const d=distance(xy,p);
        if (d>=limit) return;
        limit=d;best={way,node:nodes[i],xy,walls:[-1,1].map(step=>{
          const j=(i+step+nodes.length)%nodes.length;
          return {node:nodes[j],xy:points[j],side:-Math.sign(area)*step};
        })};
      });
    }
    return best||wallBest;
  }
  function wallNear(s,p) {
    if(!s.snap)return;
    const outline=shape(s,p);
    if(!outline)return;
    let best,limit=radius;
    // The mouse remains the opposite corner. Test the two SIDE corners.
    for(const corner of [outline[1],outline[3]]){
      for(const wall of s.snap.walls){
        const a=s.anchor,dx=wall.xy[0]-a[0],dy=wall.xy[1]-a[1],length=Math.hypot(dx,dy);
        if(length<4)continue;
        const n=[-dy*wall.side/length,dx*wall.side/length];
        // Only snap a square on the exterior side of the source building.
        if((p[0]-a[0])*n[0]+(p[1]-a[1])*n[1]<4)continue;
        const t=((corner[0]-a[0])*dx+(corner[1]-a[1])*dy)/(length*length);
        let candidate;
        if(distance(corner,wall.xy)<radius){
          candidate=wall;
        }else if(t*length>=4&&(1-t)*length>=4&&typeof getID()?.actionAddMidpoint==='function'){
          candidate={xy:[a[0]+t*dx,a[1]+t*dy],side:wall.side,splitEnd:wall.node};
        }
        if(!candidate)continue;
        const d=distance(corner,candidate.xy);
        if(d<limit){limit=d;best=candidate;}
      }
    }
    return best;
  }
  function wallSquare(s,wall) {
    const a=s.anchor,b=wall.xy,d=distance(a,b);
    const n=[-(b[1]-a[1])*wall.side/d,(b[0]-a[0])*wall.side/d];
    return [a,b,[b[0]+n[0]*d,b[1]+n[1]*d],[a[0]+n[0]*d,a[1]+n[1]*d]];
  }

  function attached(s,p) {
    const a=s.anchor,b=s.wall.xy,d=distance(a,b);
    const n=[-(b[1]-a[1])*s.wall.side/d,(b[0]-a[0])*s.wall.side/d];
    const depth=(p[0]-a[0])*n[0]+(p[1]-a[1])*n[1];
    if (depth<4) return;
    const offset=q=>[q[0]+n[0]*depth,q[1]+n[1]*depth];
    return [a,b,offset(b),offset(a)];
  }
  function preview(s, p) {
    const points = list => list.map(point => point.join(',')).join(' ');
    const snap = !s.anchor ? nearest(s,p) : null;
    s.marker.setAttribute('visibility',snap?'visible':'hidden');
    if(snap){s.marker.setAttribute('cx',snap.xy[0]);s.marker.setAttribute('cy',snap.xy[1]);}
    if (!s.anchor) return;
    const wall = s.wall || (!s.basis && wallNear(s,p));
    const ring = s.wall ? attached(s,p) : wall ? wallSquare(s,wall) : shape(s,p);
    if(wall){
      s.marker.setAttribute('visibility','visible');
      s.marker.setAttribute('cx',wall.xy[0]);s.marker.setAttribute('cy',wall.xy[1]);
    }
    s.polygon.setAttribute('points', ring ? points(ring) : '');
    s.edge.setAttribute('points',wall ? points([s.anchor,wall.xy]) :
      ring && s.axis ? points([ring[0],ring[s.axis === 'u' ? 1 : 3]]) : '');
    return ring;
  }
  document.addEventListener('cosmetics:draw-building-toggle', () => {
    if (session) return finish('drawCancelled');
    const c = getContext(), map = document.querySelector('.main-map');
    if (!map || !ready(c) || typeof c.projection?.invert !== 'function') return status('drawUnavailable');
    const overlay = document.createElementNS(ns,'svg');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:6;cursor:crosshair;touch-action:none';
    overlay.setAttribute('aria-hidden','true');
    const polygon = document.createElementNS(ns,'polygon'), edge = document.createElementNS(ns,'polyline');
    polygon.setAttribute('fill','#1688cf44');polygon.setAttribute('stroke','#1688cf');polygon.setAttribute('stroke-width','2');
    edge.setAttribute('fill','none');edge.setAttribute('stroke','#ffb300');edge.setAttribute('stroke-width','4');
    const marker=document.createElementNS(ns,'circle');
    marker.setAttribute('r','6');marker.setAttribute('fill','#ffb300');
    marker.setAttribute('visibility','hidden');
    overlay.append(polygon,edge,marker);map.append(overlay);
    const s = session = {context:c,overlay,polygon,edge,marker};
    function offset() {
      const box=overlay.getBoundingClientRect(), surface=c.surfaceRect();
      return [box.left-surface.left,box.top-surface.top];
    }
    s.invert=([x,y])=>{const [dx,dy]=offset();return c.projection.invert([x+dx,y+dy]);};
    s.project=loc=>{const [dx,dy]=offset(),[x,y]=c.projection(loc);return [x-dx,y-dy];};
    const point = e => {
      const box = overlay.getBoundingClientRect();
      return [e.clientX-box.left,e.clientY-box.top];
    };
    overlay.addEventListener('pointermove',e => preview(s,point(e)));
    for (const type of ['pointerdown','pointerup','mousedown','mouseup','dblclick','wheel','contextmenu']) {
      overlay.addEventListener(type,e => { e.preventDefault();e.stopPropagation(); },{passive:false});
    }
    overlay.addEventListener('click',e => {
      e.preventDefault();e.stopPropagation();
      if (session !== s || e.button !== 0 || e.detail > 1) return;
      if (!ready(c)) return finish('drawUnavailable');
      const p = point(e);
      if (!s.anchor) {
        s.snap=nearest(s,p);
        s.anchor=s.snap?.xy||p;
        preview(s,p);
        return status('drawSecond');
      }
      if (!s.basis&&!s.wall) {
        s.wall=wallNear(s,p);
        if(s.wall){preview(s,p);return status('drawWallDepth');}
        s.basis=square(s.anchor,p);
        if (s.basis) {preview(s,p);status('drawThird');}
        return;
      }
      try {
        const outline=preview(s,p);
        if(!outline)return;
        const ring=outline.map(s.invert);
        if (!ring.every(([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=85)) {
          return finish('drawUnavailable');
        }
        const id=getID();
        const shared=[s.snap?.node,s.wall?.node];
        const graph=c.graph?.();
        if (s.snap&&(graph?.hasEntity(s.snap.way.id)!==s.snap.way||
            [...shared,...(s.snap.edge||[]),s.wall?.splitEnd].some(n=>n&&graph?.hasEntity(n.id)!==n))) return finish('drawCancelled');
        const nodes=ring.map((loc,i)=>shared[i]||new id.osmNode({loc}));
        const way=new id.osmWay({nodes:[...nodes.map(n=>n.id),nodes[0].id],tags:{building:'yes'}});
        const anchorSplit=s.snap?.edge && id.actionAddMidpoint(
          {loc:ring[0],edge:s.snap.edge.map(n=>n.id)},nodes[0]);
        const split=s.wall?.splitEnd && id.actionAddMidpoint(
          {loc:ring[1],edge:[nodes[0].id,s.wall.splitEnd.id]},nodes[1]);
        c.perform(graph=>{
          if(anchorSplit)graph=anchorSplit(graph);
          if(split)graph=split(graph);
          return nodes.reduce((g,n,i)=>shared[i]||(anchorSplit&&i===0)||(split&&i===1)?g:g.replace(n),graph).replace(way);
        },'cOSMetics: Draw building');
        finish('drawCreated');
        c.enter(id.modeSelect(c,[way.id]));
      } catch { finish('drawUnavailable'); }
    });
    c.map().on('move.cosmeticsDrawBuilding',()=>finish('drawCancelled'));
    status('drawFirst');
  });
  document.addEventListener('cosmetics:draw-building-cancel',()=>{if(session)finish('drawCancelled');});
  window.addEventListener('keydown',e=>{
    if (session && e.key === 'Escape') {
      e.preventDefault();e.stopImmediatePropagation();finish('drawCancelled');
      return;
    }
    if (session || e.defaultPrevented || e.repeat || e.isComposing ||
        e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key !== '4') return;
    if (e.composedPath().some(node => node.isContentEditable ||
        node.matches?.('input, textarea, select, [role="textbox"]'))) return;
    const button = document.getElementById('cosmetics-draw-building');
    if (!button?.getClientRects().length || !ready(getContext())) return;
    e.preventDefault();e.stopImmediatePropagation();
    button.click();
  },true);
};
