// Independent Douglas–Peucker implementation, with protected anchors and
// spherical distances in metres. This file contains no JOSM source code.
(() => {
  'use strict';
  const R = 6378137, rad = Math.PI / 180;
  const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => Math.hypot(...a);
  const unit = loc => {const lat=loc[1]*rad,lon=loc[0]*rad;return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];};
  const angle = (a,b) => Math.atan2(norm(cross(a,b)),dot(a,b));
  function distanceToSegment(p, a, b) {
    const normal = cross(a,b), length=norm(normal);
    const endpoint=Math.min(angle(p,a),angle(p,b));
    if(length<1e-14)return R*endpoint;
    const n=normal.map(v=>v/length), offset=dot(p,n);
    const projected=p.map((v,i)=>v-offset*n[i]), magnitude=norm(projected);
    if(magnitude<1e-14)return R*endpoint;
    const q=projected.map(v=>v/magnitude);
    const onArc=dot(cross(a,q),n)>=-1e-13 && dot(cross(q,b),n)>=-1e-13;
    return R*(onArc?Math.min(angle(p,q),endpoint):endpoint);
  }
  function flat(loc) {return [loc[0]*rad,Math.log(Math.tan(Math.PI/4+loc[1]*rad/2))];}
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on=(a,b,c)=>Math.abs(turn(a,b,c))<1e-16&&c[0]>=Math.min(a[0],b[0])-1e-14&&c[0]<=Math.max(a[0],b[0])+1e-14&&c[1]>=Math.min(a[1],b[1])-1e-14&&c[1]<=Math.max(a[1],b[1])+1e-14;
  function intersects(a,b,c,d) {
    if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
    return (turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
  }
  function validShape(points, closed) {
    const n=points.length;
    if(n<(closed?4:2))throw new Error('La semplificazione eliminerebbe troppi vertici. Riduci la tolleranza.');
    for(let i=0;i<n-1;i++) {
      if(Math.hypot(points[i+1][0]-points[i][0],points[i+1][1]-points[i][1])<1e-14)throw new Error('La geometria contiene segmenti di lunghezza nulla.');
      for(let j=i+2;j<n-1;j++) {
        if(closed&&i===0&&j===n-2)continue;
        if(intersects(points[i],points[i+1],points[j],points[j+1]))throw new Error('Geometria non semplice o autointersezione: riduci la tolleranza oppure intervieni manualmente.');
      }
    }
    if(closed) {
      let area=0;
      const origin=points[0];
      for(let i=1;i<n-2;i++)area+=turn(origin,points[i],points[i+1]);
      if(Math.abs(area)<1e-17)throw new Error('Il poligono risultante è degenere. Riduci la tolleranza.');
      return Math.sign(area);
    }
    return 0;
  }
  function simplify(nodes, tolerance, {inner=false}={}) {
    if(!Number.isFinite(tolerance)||tolerance<0.1||tolerance>10)throw new Error('La tolleranza deve essere compresa tra 0,1 e 10 metri.');
    if(!Array.isArray(nodes)||nodes.length<3||nodes.length>4000)throw new Error('Seleziona una way con almeno 3 e non più di 4.000 nodi.');
    for(const n of nodes)if(typeof n.id!=='string'||!Array.isArray(n.loc)||n.loc.length!==2||!n.loc.every(Number.isFinite)||Math.abs(n.loc[0])>180||Math.abs(n.loc[1])>=85)throw new Error('Coordinate mancanti o non supportate.');
    const closed=nodes[0].id===nodes.at(-1).id;
    const lons=nodes.map(n=>n.loc[0]);
    if(Math.max(...lons)-Math.min(...lons)>180)throw new Error('Geometrie attraverso l’antimeridiano non supportate in questa bozza.');
    const original=nodes.map(n=>flat(n.loc));
    const originalOrientation=validShape(original,closed);
    const vectors=nodes.map(n=>unit(n.loc));
    const frequencies=new Map();
    for(const n of nodes.slice(0,closed?-1:undefined))frequencies.set(n.id,(frequencies.get(n.id)||0)+1);
    const keep=new Set([0,nodes.length-1]);
    nodes.forEach((n,i)=>{if(n.protected||frequencies.get(n.id)>1)keep.add(i);});
    // Split a ring into two non-zero-length arcs before simplifying it.
    if(closed){let far=1;for(let i=2;i<nodes.length-1;i++)if(angle(vectors[0],vectors[i])>angle(vectors[0],vectors[far]))far=i;keep.add(far);}
    const anchors=[...keep].sort((a,b)=>a-b), jobs=[];
    for(let i=1;i<anchors.length;i++)jobs.push([anchors[i-1],anchors[i]]);
    while(jobs.length) {
      const [start,end]=jobs.pop();if(end-start<2)continue;
      let far=-1,max=-1;
      for(let i=start+1;i<end;i++){const d=distanceToSegment(vectors[i],vectors[start],vectors[end]);if(d>max){max=d;far=i;}}
      if(max>=tolerance){keep.add(far);jobs.push([start,far],[far,end]);}
    }
    let indices=[...keep].sort((a,b)=>a-b);
    const innerRequired=new Set();
    if(inner){
      if(!closed)throw new Error('L’anello interno deve essere una way chiusa.');
      const coordinates=nodes.map(n=>n.loc);
      for(let s=1;s<indices.length;s++){
        const a=indices[s-1],b=indices[s];
        if(!staysWithin(coordinates,[nodes[a].loc,nodes[b].loc])){
          for(let i=a+1;i<b;i++){keep.add(i);innerRequired.add(i);}
        }
      }
      indices=[...keep].sort((a,b)=>a-b);
    }
    if(closed&&new Set(indices.map(i=>nodes[i].id)).size<3)throw new Error('La tolleranza collasserebbe il poligono. Riducila.');
    const result=indices.map(i=>nodes[i]);
    if(validShape(result.map(n=>flat(n.loc)),closed)!==originalOrientation)throw new Error('La semplificazione invertirebbe il poligono. Riduci la tolleranza.');
    let maxError=0;
    for(let s=1;s<indices.length;s++)for(let i=indices[s-1]+1;i<indices[s];i++)maxError=Math.max(maxError,distanceToSegment(vectors[i],vectors[indices[s-1]],vectors[indices[s]]));
    return {ids:result.map(n=>n.id),coordinates:result.map(n=>[...n.loc]),removed:nodes.filter((_,i)=>!keep.has(i)).map(n=>n.id),
      beforeCount:closed?nodes.length-1:nodes.length,afterCount:closed?result.length-1:result.length,
      protectedCount:new Set(nodes.filter((n,i)=>n.protected||innerRequired.has(i)||i===0||i===nodes.length-1).map(n=>n.id)).size,closed,maxError};
  }
  // An inner ring may shrink inside itself without expanding into neighboring
  // holes or beyond the original outer boundary. Split every proposed edge at
  // all original-edge intersections, then check every resulting interval.
  function staysWithin(original,proposed) {
    const ring=original.map(flat),candidate=proposed.map(flat);
    function inside(p) {
      let hit=false;
      for(let i=0;i<ring.length-1;i++) {
        const a=ring[i],b=ring[i+1];if(on(a,b,p))return true;
        if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
      }
      return hit;
    }
    for(let i=0;i<candidate.length-1;i++) {
      const a=candidate[i],b=candidate[i+1],dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy,breaks=[0,1];
      if(!len)return false;
      if(!inside(a)||!inside(b))return false;
      for(let j=0;j<ring.length-1;j++) {
        const c=ring[j],d=ring[j+1],ex=d[0]-c[0],ey=d[1]-c[1],den=dx*ey-dy*ex;
        if(Math.abs(den)>1e-22) {
          const t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/den;
          const u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/den;
          if(t>0&&t<1&&u>=0&&u<=1)breaks.push(t);
        } else if(Math.abs(turn(a,b,c))<1e-16) {
          for(const p of [c,d]){const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len;if(t>0&&t<1)breaks.push(t);}
        }
      }
      breaks.sort((a,b)=>a-b);
      for(let k=1;k<breaks.length;k++) {
        if(breaks[k]-breaks[k-1]<1e-10)continue;
        const t=(breaks[k]+breaks[k-1])/2;
        if(!inside([a[0]+t*dx,a[1]+t*dy]))return false;
      }
    }
    return true;
  }
  const api=Object.freeze({simplify,distanceToSegment,unit,staysWithin});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else globalThis.CosmeticsSimplifyCore=api;
})();
