// Main-world drawing session. Only the final click changes the iD graph.
globalThis.CosmeticsDrawBuilding = function(getContext, getID) {
  const ns = 'http://www.w3.org/2000/svg';
  let session;
  const status = key => document.dispatchEvent(new CustomEvent('cosmetics:draw-building-state', {
    detail: JSON.stringify({ key, active: !!session, mode: session?.mode, curving: !!session?.curving })
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
  function nearest(s,p,ortho=false) {
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
          if(d>=wallLimit || (ortho && s.vertices.some(q=>distance(q,xy)<4)))return;
          wallLimit=d;
          wallBest={way,xy,t,edge:[nodes[i],nodes[j]],walls:[
            {node:nodes[i],xy:start,side:Math.sign(area)},
            {node:nodes[j],xy:end,side:-Math.sign(area)}
          ]};
        });
      }
      points.forEach((xy,i)=>{
        if (ortho && s.sharedIDs.has(nodes[i].id)) return;
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
  function intersects(a,b,c,d) {
    const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    const sign=n=>Math.abs(n)<1e-7?0:Math.sign(n);
    return [0,1].every(i=>Math.max(Math.min(a[i],b[i]),Math.min(c[i],d[i]))<=
      Math.min(Math.max(a[i],b[i]),Math.max(c[i],d[i]))+1e-7) &&
      sign(cross(a,b,c))*sign(cross(a,b,d))<=0 && sign(cross(c,d,a))*sign(cross(c,d,b))<=0;
  }
  function orthoPreview(s,p,free=false) {
    const ring=s.vertices, last=ring.at(-1);
    const previous=ring.at(-2);
    const close=ring.length>=3 && distance(p,ring[0])<radius;
    const snap=close?null:nearest(s,p,true);
    let xy=close?ring[0]:snap?.xy||p, straight=false;
    s.marker.setAttribute('visibility',close||snap?'visible':'hidden');
    if(close||snap){s.marker.setAttribute('cx',xy[0]);s.marker.setAttribute('cy',xy[1]);}
    if (!last) return {xy,snap,valid:true};
    if (close||snap) s.useMain=undefined;
    if (!close && !snap && previous && !free) {
      const [u,v]=s.axes;
      const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
      const base=s.curveEnds.get(last)||previous;
      const incoming=[last[0]-base[0],last[1]-base[1]];
      const iu=dot(incoming,u),iv=dot(incoming,v);
      const axial=Math.min(Math.abs(iu),Math.abs(iv))<1e-7;
      const delta=[p[0]-last[0],p[1]-last[1]];
      const main=Math.abs(iu)>=Math.abs(iv)?u:v, side=main===u?v:u;
      const sign=Math.sign(main===u?iu:iv);
      const along=dot(delta,main), across=dot(delta,side);
      // After an oblique edge, either original axis is available in both directions.
      const advantage=(axial?along*sign:Math.abs(along))-Math.abs(across);
      if (s.useMain===undefined || Math.abs(advantage)>3 || (axial && s.useMain && along*sign<=0)) s.useMain=advantage>=0;
      straight=axial && s.useMain && along*sign>0 && !s.shared.has(last) && !s.curveEnds.has(last);
      const axis=s.useMain?main:side, step=s.useMain?along:across;
      xy=[last[0]+axis[0]*step,last[1]+axis[1]*step];
    }
    const start=straight?previous:last;
    const overlaps=(joint,a,b)=>{
      const ax=a[0]-joint[0],ay=a[1]-joint[1],bx=b[0]-joint[0],by=b[1]-joint[1];
      return Math.abs(ax*by-ay*bx)<1e-7 && ax*bx+ay*by>0;
    };
    const valid=distance(last,xy)>=4 && !ring.slice(0,straight?-3:-2).some((point,i)=>
      !(close&&i===0) && intersects(start,xy,point,ring[i+1])) &&
      (!previous || !overlaps(last,previous,xy)) &&
      (!close || !overlaps(xy,last,ring[1]));
    const points=list=>list.map(point=>point.join(',')).join(' ');
    s.polygon.setAttribute('points',points(ring));
    s.edge.setAttribute('points',distance(last,xy)>0?points([last,xy]):'');
    s.edge.setAttribute('stroke',valid?'#ffb300':'#c63535');
    return {xy,snap,straight,close,valid};
  }
  function arcTarget(c) {
    const ids=c.selectedIDs?.(), graph=c.graph?.();
    const way=ids?.length===1?graph?.hasEntity(ids[0]):null;
    if(way?.type!=='way'||!way.tags.building||way.tags.building==='no'||!way.isClosed?.()||
       graph.parentRelations(way).length) return;
    const refs=way.nodes.slice(0,-1);
    const nodes=refs.map(id=>graph.hasEntity(id));
    if(nodes.length<3||new Set(refs).size!==refs.length||nodes.some(n=>!n?.loc))return;
    return {way,nodes};
  }
  const pointList=list=>list.map(point=>point.join(',')).join(' ');
  function arcPoints(s,p,a,b,locA,locB) {
    const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],r=distance(a,b)/2;
    const u=[(a[0]-mid[0])/r,(a[1]-mid[1])/r], v=[-u[1],u[0]];
    const cross=(p[0]-mid[0])*v[0]+(p[1]-mid[1])*v[1];
    if(Math.abs(cross)>2)s.arcSide=Math.sign(cross);
    const side=s.arcSide||1, [lon,lat]=locA,[lon2,lat2]=locB;
    const meters=Math.hypot((lon2-lon)*Math.cos((lat+lat2)*Math.PI/360),lat2-lat)*111195;
    const angle=Math.acos(1-Math.min(1,0.4/Math.max(meters/2,0.4)));
    const steps=Math.max(6,Math.min(64,Math.ceil(Math.PI/(2*angle))));
    const arc=[a];
    for(let k=1;k<steps;k++){
      const t=k*Math.PI/steps,x=r*Math.cos(t),y=side*r*Math.sin(t);
      arc.push([mid[0]+x*u[0]+y*v[0],mid[1]+x*u[1]+y*v[1]]);
    }
    arc.push(b);
    return arc;
  }
  function orthoArc(s,p) {
    const a=s.vertices.at(-2),b=s.vertices.at(-1);
    const arc=arcPoints(s,p,a,b,s.invert(a),s.invert(b));
    const lastEdge=s.vertices.length-2;
    const valid=!arc.slice(0,-1).some((q,k)=>s.vertices.slice(0,lastEdge).some((c,i)=>{
      const d=s.vertices[i+1];
      if(k===0&&i===lastEdge-1){
        const x=arc[1][0]-a[0],y=arc[1][1]-a[1],xx=c[0]-a[0],yy=c[1]-a[1];
        return Math.abs(x*yy-y*xx)<1e-7&&x*xx+y*yy>0;
      }
      return intersects(q,arc[k+1],c,d);
    }));
    s.edge.setAttribute('stroke',valid?'#ffb300':'#c63535');
    s.edge.setAttribute('points',pointList(arc));
    return {arc,valid};
  }
  function orthoArcMode(s,active) {
    s.curving=active;
    s.arcSide=undefined;
    s.useMain=undefined;
    s.marker.setAttribute('visibility','hidden');
    s.edge.setAttribute('points','');
    s.polygon.setAttribute('points',pointList(active?s.vertices.slice(0,-1):s.vertices));
    if(active&&s.cursor)orthoArc(s,s.cursor);
    status(active?'drawArcSide':'drawOrthoNext');
  }
  function sharedDiameter(s,a,b){
    const first=s.shared.get(a),last=s.shared.get(b);
    if(!first||!last)return false;
    if(first.node&&last.node)return s.context.graph().parentWays(first.node)
      .some(w=>w.areAdjacent(first.node.id,last.node.id));
    const edge=(first.edge||last.edge).map(n=>n.id);
    const other=first.edge?last:first;
    return other.node?edge.includes(other.node.id):other.edge.every(n=>edge.includes(n.id));
  }
  function semicircle(s,p) {
    const {nodes}=s.target, ring=nodes.map(n=>s.project(n.loc)), count=ring.length;
    if(s.arcIndex===undefined){
      let index, nearest=radius;
      ring.forEach((a,i)=>{
        const b=ring[(i+1)%count], dx=b[0]-a[0],dy=b[1]-a[1], ds=dx*dx+dy*dy;
        if(ds<16)return;
        const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/ds));
        const d=distance(p,[a[0]+t*dx,a[1]+t*dy]);
        if(d<nearest){index=i;nearest=d;}
      });
      if(index===undefined){s.edge.setAttribute('points','');return {};}
      const j=(index+1)%count, graph=s.context.graph();
      const blocked=graph.parentWays(nodes[index]).some(w=>w.id!==s.target.way.id&&w.areAdjacent(nodes[index].id,nodes[j].id));
      s.edge.setAttribute('stroke',blocked?'#c63535':'#ffb300');
      s.edge.setAttribute('points',pointList([ring[index],ring[j]]));
      return {index,blocked};
    }
    const i=s.arcIndex,j=(i+1)%count,a=ring[i],b=ring[j];
    const arc=arcPoints(s,p,a,b,nodes[i].loc,nodes[j].loc),steps=arc.length-1;
    const valid=!arc.slice(0,-1).some((q,k)=>ring.some((c,l)=>{
      if(l===i)return false;
      const end=(l+1)%count,d=ring[end];
      // The two perimeter edges incident to the diameter may touch its endpoints.
      if((k===0&&end===i)||(k===steps-1&&l===j)){
        const [joint,m,n]=k===0?[a,arc[1],c]:[b,q,d];
        const x=m[0]-joint[0],y=m[1]-joint[1],xx=n[0]-joint[0],yy=n[1]-joint[1];
        return Math.abs(x*yy-y*xx)<1e-7&&x*xx+y*yy>0;
      }
      return intersects(q,arc[k+1],c,d);
    }));
    s.edge.setAttribute('stroke',valid?'#ffb300':'#c63535');
    s.edge.setAttribute('points',pointList(arc));
    return {arc,valid};
  }
  function applyArc(s,arc) {
    const c=s.context,graph=c.graph(),{way,nodes}=s.target,i=s.arcIndex;
    const next=(i+1)%nodes.length;
    if(arcTarget(c)?.way!==way||nodes.some(n=>graph.hasEntity(n.id)!==n)||
       graph.parentWays(nodes[i]).some(w=>w.id!==way.id&&w.areAdjacent(nodes[i].id,nodes[next].id))) {
      return finish('drawCancelled');
    }
    const locs=arc.slice(1,-1).map(s.invert);
    if(!locs.every(([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=85))return;
    const id=getID(),added=locs.map(loc=>new id.osmNode({loc}));
    const refs=way.nodes.slice();
    refs.splice(i+1,0,...added.map(n=>n.id));
    c.perform(g=>added.reduce((out,n)=>out.replace(n),g).replace(way.update({nodes:refs})),'cOSMetics: Semicircular wall');
    finish('drawArcDone');
    c.enter(id.modeSelect(c,[way.id]));
  }
  function start(mode) {
    if (session?.mode===mode) return finish('drawCancelled');
    if (session) finish('drawCancelled');
    const c = getContext(), map = document.querySelector('.main-map');
    if (!map || !ready(c) || typeof c.projection?.invert !== 'function') return status('drawUnavailable');
    const target=mode==='arc'?arcTarget(c):null;
    if(mode==='arc'&&!target)return status('drawArcSelect');
    const overlay = document.createElementNS(ns,'svg');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:6;cursor:crosshair;touch-action:none';
    overlay.setAttribute('aria-hidden','true');
    const polygon = document.createElementNS(ns,mode==='ortho'?'polyline':'polygon'), edge = document.createElementNS(ns,'polyline');
    polygon.setAttribute('fill',mode==='ortho'?'none':'#1688cf44');polygon.setAttribute('stroke','#1688cf');polygon.setAttribute('stroke-width','2');
    edge.setAttribute('fill','none');edge.setAttribute('stroke','#ffb300');edge.setAttribute('stroke-width','4');
    const marker=document.createElementNS(ns,'circle');
    marker.setAttribute('r','6');marker.setAttribute('fill','#ffb300');
    marker.setAttribute('visibility','hidden');
    overlay.append(polygon,edge,marker);map.append(overlay);
    const s = session = {context:c,overlay,polygon,edge,marker,mode,target,vertices:[],shared:new Map(),sharedIDs:new Set(),curveEnds:new Map()};
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
    s.setFree=free=>{
      if (s.free!==free) {s.free=free;s.useMain=undefined;}
    };
    function pointerPreview(e) {
      s.cursor=point(e);
      s.setFree(!!e.shiftKey);
      return s.curving?orthoArc(s,s.cursor):orthoPreview(s,s.cursor,s.free);
    }
    overlay.addEventListener('pointermove',e => mode==='arc'?semicircle(s,point(e)):mode==='ortho'?pointerPreview(e):preview(s,point(e)));
    overlay.addEventListener('pointerleave',()=>{s.cursor=undefined;});
    for (const type of ['pointerdown','pointerup','mousedown','mouseup','dblclick','wheel','contextmenu']) {
      overlay.addEventListener(type,e => { e.preventDefault();e.stopPropagation(); },{passive:false});
    }
    overlay.addEventListener('click',e => {
      e.preventDefault();e.stopPropagation();
      if (session !== s || e.button !== 0 || e.detail > 1) return;
      if (!ready(c)) return finish('drawUnavailable');
      const p = point(e);
      if(mode==='arc'){
        const result=semicircle(s,p);
        if(s.arcIndex===undefined){
          if(result.blocked)return status('drawArcBlocked');
          if(result.index===undefined)return;
          s.arcIndex=result.index;
          status('drawArcSide');
          return;
        }
        if(!result.valid)return status('drawArcBlocked');
        return applyArc(s,result.arc);
      }
      if (mode==='ortho') {
        const result=pointerPreview(e);
        if (!result.valid) return;
        if(s.curving){
          const a=s.vertices.at(-2),b=s.vertices.at(-1);
          s.vertices.splice(s.vertices.length-1,0,...result.arc.slice(1,-1));
          s.curveEnds.set(b,a);
          return orthoArcMode(s,false);
        }
        if (result.close) return commit(s.vertices);
        if(result.straight)s.vertices[s.vertices.length-1]=result.xy;
        else s.vertices.push(result.xy);
        if (result.snap) {
          s.shared.set(result.xy,result.snap);
          if(result.snap.node) s.sharedIDs.add(result.snap.node.id);
        }
        s.marker.setAttribute('visibility','hidden');
        if (s.vertices.length===1) return status('drawOrthoSecond');
        if (!s.axes) {
          const [a,b]=s.vertices,len=distance(a,b);
          const u=[(b[0]-a[0])/len,(b[1]-a[1])/len];
          s.axes=[u,[-u[1],u[0]]];
        }
        s.polygon.setAttribute('points',s.vertices.map(p=>p.join(',')).join(' '));
        s.edge.setAttribute('points','');
        s.useMain=undefined;
        return status('drawOrthoNext');
      }
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
      const outline=preview(s,p);
      if(outline)commit(outline);
    });
    function commit(outline) {
      try {
        const ring=outline.map(s.invert);
        if (!ring.every(([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=85)) {
          return finish('drawUnavailable');
        }
        const id=getID();
        const graph=c.graph?.();
        const shared=mode==='ortho'?outline.map(xy=>s.shared.get(xy)?.node):[s.snap?.node,s.wall?.node];
        for(const {way,node,edge} of s.shared.values()){
          if(graph?.hasEntity(way.id)!==way ||
             (node?[node]:edge).some(n=>graph?.hasEntity(n.id)!==n)) return finish('drawCancelled');
        }
        if (s.snap&&(graph?.hasEntity(s.snap.way.id)!==s.snap.way||
            [...shared,...(s.snap.edge||[]),s.wall?.splitEnd].some(n=>n&&graph?.hasEntity(n.id)!==n))) return finish('drawCancelled');
        const nodes=ring.map((loc,i)=>shared[i]||new id.osmNode({loc}));
        const way=new id.osmWay({nodes:[...nodes.map(n=>n.id),nodes[0].id],tags:{building:'yes'}});
        const anchorSplit=s.snap?.edge && id.actionAddMidpoint(
          {loc:ring[0],edge:s.snap.edge.map(n=>n.id)},nodes[0]);
        const split=s.wall?.splitEnd && id.actionAddMidpoint(
          {loc:ring[1],edge:[nodes[0].id,s.wall.splitEnd.id]},nodes[1]);
        // Insert points on the same edge in order, advancing its split endpoint.
        const wallGroups=new Map();
        outline.forEach((xy,i)=>{
          const snap=s.shared.get(xy);
          if(!snap?.edge)return;
          const [from,to]=snap.edge.map(n=>n.id);
          const forward=from<to, edge=forward?[from,to]:[to,from];
          const key=edge.join('/');
          if(!wallGroups.has(key))wallGroups.set(key,{edge,items:[]});
          wallGroups.get(key).items.push({t:forward?snap.t:1-snap.t,node:nodes[i]});
        });
        const wallSplits=[];
        for(const {edge:[from,to],items} of wallGroups.values()){
          let prev=from;
          for(const {node} of items.sort((a,b)=>a.t-b.t)){
            wallSplits.push(id.actionAddMidpoint({loc:node.loc,edge:[prev,to]},node));
            prev=node.id;
          }
        }
        c.perform(graph=>{
          for(const add of wallSplits)graph=add(graph);
          if(anchorSplit)graph=anchorSplit(graph);
          if(split)graph=split(graph);
          return nodes.reduce((g,n,i)=>s.shared.get(outline[i])?.edge||shared[i]||(anchorSplit&&i===0)||(split&&i===1)?g:g.replace(n),graph).replace(way);
        },mode==='ortho'?'cOSMetics: Draw orthogonal building':'cOSMetics: Draw building');
        finish('drawCreated');
        c.enter(id.modeSelect(c,[way.id]));
      } catch { finish('drawUnavailable'); }
    }
    c.map().on('move.cosmeticsDrawBuilding',()=>finish('drawCancelled'));
    status(mode==='arc'?'drawArcEdge':mode==='ortho'?'drawOrthoFirst':'drawFirst');
  }
  document.addEventListener('cosmetics:draw-building-toggle',()=>start('rectangle'));
  document.addEventListener('cosmetics:draw-arc-toggle',()=>{
    const s=session;
    if(s?.mode!=='ortho')return start('arc');
    if(s.curving)return orthoArcMode(s,false);
    const a=s.vertices.at(-2),b=s.vertices.at(-1);
    if(!a||s.curveEnds.has(b))return status('drawArcOrthoEdge');
    if(sharedDiameter(s,a,b))return status('drawArcBlocked');
    orthoArcMode(s,true);
  });
  document.addEventListener('cosmetics:draw-ortho-toggle',()=>start('ortho'));
  document.addEventListener('cosmetics:draw-building-cancel',()=>{if(session)finish('drawCancelled');});
  function shift(free) {
    const s=session;
    if (s?.mode!=='ortho') return;
    s.setFree(free);
    if (s.cursor&&!s.curving) orthoPreview(s,s.cursor,free);
  }
  window.addEventListener('keyup',e=>{if(e.key==='Shift')shift(!!e.shiftKey);},true);
  window.addEventListener('blur',()=>shift(false));
  window.addEventListener('keydown',e=>{
    if(e.key==='Shift')shift(true);
    if (session && e.key === 'Escape') {
      e.preventDefault();e.stopImmediatePropagation();
      if(session.curving)orthoArcMode(session,false);
      else finish('drawCancelled');
      return;
    }
    const buttonId = ({'4':'cosmetics-draw-building','5':'cosmetics-draw-ortho','6':'cosmetics-draw-arc'})[e.key];
    if (session && !(session.mode==='ortho' && e.key==='6')) return;
    if (!buttonId || e.defaultPrevented || e.repeat || e.isComposing ||
        e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.composedPath().some(node => node.isContentEditable ||
        node.matches?.('input, textarea, select, [role="textbox"]'))) return;
    const button = document.getElementById(buttonId);
    if (!button?.getClientRects().length || !ready(getContext())) return;
    e.preventDefault();e.stopImmediatePropagation();
    button.click();
  },true);
};
