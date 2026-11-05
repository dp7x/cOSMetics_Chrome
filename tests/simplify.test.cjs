const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../simplify-core.js');
const point=(id,x,y,extra={})=>({id,loc:[x/111319.49079327358,y/111319.49079327358],...extra});
const line=()=>[point('n1',0,0),point('n2',10,.2),point('n3',20,-.2),point('n4',30,.1),point('n5',40,0)];

test('Metre tolerance removes redundant vertices without moving retained nodes',()=>{
  const original=line(),r=core.simplify(original,.5);
  assert.deepEqual(r.ids,['n1','n5']);assert.equal(r.beforeCount,5);assert.equal(r.afterCount,2);assert(r.maxError<=.5);
  assert.deepEqual(r.coordinates,[original[0].loc,original[4].loc]);
  assert(core.simplify(original,.1).afterCount>r.afterCount);
  const bound=core.distanceToSegment(core.unit(point('p',-10,1).loc),core.unit(point('a',0,0).loc),core.unit(point('b',10,0).loc));
  assert(bound>10&&bound<10.1);
});
test('Protected anchors survive and divide the way into independent segments',()=>{
  const nodes=line();nodes[2].protected=true;
  const r=core.simplify(nodes,1);assert(r.ids.includes('n3'));assert.equal(r.protectedCount,3);assert.equal(r.ids[0],'n1');assert.equal(r.ids.at(-1),'n5');
});
test('Closed polygons remain closed, nondegenerate and consistently oriented',()=>{
  const nodes=[[0,0],[10,0],[20,0],[20,10],[20,20],[10,20],[0,20],[0,10]].map(([x,y],i)=>point('n'+i,x,y));nodes.push(nodes[0]);
  const r=core.simplify(nodes,.5);assert.equal(r.closed,true);assert.equal(r.afterCount,4);assert.equal(r.ids[0],r.ids.at(-1));assert.equal(r.beforeCount,8);
  assert.throws(()=>core.simplify([point('a',0,0),point('b',1,0),point('c',0,1),point('a',0,0)],10),/collass|vertici/);
});
test('Rejects invalid inputs, incomplete coordinates and self-crossing geometry',()=>{
  const bow=[[0,0],[10,10],[0,10],[10,0]].map(([x,y],i)=>point('n'+i,x,y));
  assert.throws(()=>core.simplify(bow,.5),/autointersezione/);
  for(const tolerance of [NaN,0,11])assert.throws(()=>core.simplify(line(),tolerance));
  assert.throws(()=>core.simplify([{id:'n1',loc:[179,0]},{id:'n2',loc:[-179,0]},{id:'n3',loc:[179,1]}],1),/antimeridiano/);
  assert.throws(()=>core.simplify([point('a',0,0),point('b',0,0),point('c',10,0)],.5),/lunghezza nulla/);
});
test('Long smooth geometry stays within tolerance with every required anchor retained',()=>{
  const nodes=Array.from({length:600},(_,i)=>point('n'+i,i*.6,Math.sin(i/17)*2,{protected:i%79===0}));
  for(const tolerance of [.1,.5,1,3]){const r=core.simplify(nodes,tolerance);assert(r.maxError<tolerance+1e-8);for(const n of nodes.filter(n=>n.protected))assert(r.ids.includes(n.id));}
});

function entity(data){return {...data,update(change){return entity({...this,...change})}};}
class Graph {
  constructor(items){this.items=new Map(items.map?items.map(e=>[e.id,e]):items);}
  hasEntity(id){return this.items.get(id)}
  replace(e){const m=new Map(this.items);m.set(e.id,e);return new Graph(m)}
  remove(e){const m=new Map(this.items);m.delete(e.id);return new Graph(m)}
  parentWays(n){return [...this.items.values()].filter(e=>e.type==='way'&&e.nodes.includes(n.id))}
  parentRelations(n){return [...this.items.values()].filter(e=>e.type==='relation'&&e.members.some(m=>m.id===n.id))}
}
function setup(extra=[]){
  const nodes=line().map(p=>entity({id:p.id,type:'node',loc:p.loc,tags:{}}));
  const way=entity({id:'w1',type:'way',nodes:nodes.map(n=>n.id),tags:{highway:'path',name:'Example'},version:7});
  let graph=new Graph([...nodes,way,...extra]),selected=['w1'];
  const stack=[{graph,annotation:'Previous operation'}],handlers={},replies=[];
  const history={on(){return this},undoAnnotation:()=>stack.at(-1).annotation};
  const c={graph:()=>graph,selectedIDs:()=>selected,mode:()=>({id:'select'}),inIntro:()=>false,editable:()=>true,history:()=>history,on(){return this},map:()=>({on(){return this}}),
    perform(action,annotation){graph=action(graph);stack.push({graph,annotation});},undo(){stack.pop();graph=stack.at(-1).graph}};
  const sandbox={CosmeticsSimplifyCore:core,setTimeout,clearTimeout,document:{addEventListener:(type,fn)=>handlers[type]=fn,dispatchEvent:event=>replies.push(JSON.parse(event.detail)),querySelector:()=>null},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o.detail}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/simplify-bridge.js'),'utf8'),sandbox);sandbox.CosmeticsSimplifyBridge(()=>c);
  const request=(action,data={})=>{const requestId=String(Math.random());handlers['cosmetics:simplify-request']({detail:JSON.stringify({...data,action,requestId})});return replies.find(r=>r.requestId===requestId)};
  return {c,request,select:ids=>selected=ids,depth:()=>stack.length,change:e=>{graph=graph.replace(e)},nodes,way};
}
test('Preview does not edit; apply deletes only redundant orphan nodes and Undo restores exact state',()=>{
  const s=setup(),before=s.c.graph(),r=s.request('preview',{tolerance:.5});assert.equal(r.ok,true);assert.equal(s.c.graph(),before);assert.equal(s.depth(),1);
  const applied=s.request('apply',{token:r.token});assert.equal(applied.ok,true);assert.equal(s.depth(),2);assert.equal(applied.canUndo,true);
  assert.deepEqual(s.c.graph().hasEntity('w1').nodes,['n1','n5']);assert.equal(s.c.graph().hasEntity('n2'),undefined);assert.equal(s.c.graph().hasEntity('w1').tags,s.way.tags);assert.equal(s.c.graph().hasEntity('w1').version,7);
  assert.equal(s.request('undo').ok,true);assert.equal(s.c.graph(),before);assert(s.c.graph().hasEntity('n2'));
});
test('Tagged nodes, shared nodes and relation members cannot be removed',()=>{
  const s=setup([entity({id:'w2',type:'way',nodes:['n3','n10'],tags:{}}),entity({id:'r1',type:'relation',members:[{id:'n4',role:'stop',type:'node'}],tags:{type:'route'}})]);
  s.change(s.nodes[1].update({tags:{barrier:'gate'}}));const r=s.request('preview',{tolerance:1});
  assert.equal(r.ok,true);assert.equal(r.noChanges,true);assert.equal(s.depth(),1);
});
test('Stale previews and newly discovered references are rejected',()=>{
  const s=setup(),p=s.request('preview',{tolerance:.5});s.change(s.nodes[1].update({loc:[12,42]}));assert.equal(s.request('apply',{token:p.token}).ok,false);assert.equal(s.depth(),1);
  const t=setup(),q=t.request('preview',{tolerance:.5});t.change(entity({id:'w2',type:'way',nodes:['n2','n10'],tags:{}}));assert.equal(t.request('apply',{token:q.token}).ok,false);assert.equal(t.depth(),1);
});
test('Panel Undo never undoes an intervening editor action; Ctrl+Z also invalidates panel Undo',()=>{
  const s=setup(),p=s.request('preview',{tolerance:.5});s.request('apply',{token:p.token});s.c.perform(g=>g.replace(entity({id:'n100',type:'node',loc:[1,1],tags:{}})),'Manual edit');
  assert.equal(s.request('status').canUndo,false);assert.equal(s.request('undo').ok,false);assert(s.c.graph().hasEntity('n100'));
  const t=setup(),q=t.request('preview',{tolerance:.5});t.request('apply',{token:q.token});t.c.undo();assert.equal(t.request('status').canUndo,false);
});
test('Only one complete way is accepted; multipolygon members are deferred',()=>{
  const s=setup();s.select(['n1']);assert.equal(s.request('status').eligible,false);s.select(['w1','n1']);assert.equal(s.request('status').eligible,false);
  const t=setup([entity({id:'r3',type:'relation',members:[{id:'w1',role:'outer'}],tags:{type:'multipolygon'}})]);assert.equal(t.request('preview',{tolerance:.5}).ok,false);
});

test('Apply reaches the iD minimum editable zoom for a very large selection',()=>{
  const s=setup();let zoom=7;
  s.c.editable=()=>zoom>=16;s.c.minEditableZoom=()=>16;
  s.c.map=()=>({on(){return this},zoom(value){if(value!==undefined)zoom=value;return zoom}});
  const p=s.request('preview',{tolerance:.5});assert.equal(p.ok,true);
  assert.equal(s.request('apply',{token:p.token}).ok,true);assert.equal(zoom,16);
});

test('A complex closed natural=wood polygon is simplified without highway tags',()=>{
  const s=setup(),ring=[];
  for(let i=0;i<240;i++){
    const a=2*Math.PI*i/240,p=point('n'+(1000+i),70*Math.cos(a),70*Math.sin(a));
    s.change(entity({id:p.id,type:'node',loc:p.loc,tags:{}}));ring.push(p.id);
  }
  ring.push(ring[0]);const tags={natural:'wood',name:'Example wood'};
  s.c.perform(g=>g.replace(s.way.update({nodes:ring,tags})),'Preparazione poligono');
  const p=s.request('preview',{tolerance:.5});assert.equal(p.ok,true);assert.equal(p.beforeCount,240);assert(p.afterCount<100);assert.equal(p.closed,true);
  assert.equal(s.request('apply',{token:p.token}).ok,true);
  const after=s.c.graph().hasEntity('w1');assert.equal(after.nodes[0],after.nodes.at(-1));assert.equal(after.tags,tags);assert.equal(after.tags.highway,undefined);
  assert.equal(s.request('undo').ok,true);assert.deepEqual(s.c.graph().hasEntity('w1').nodes,ring);
});

test('Inner-ring constraints keep shortcuts inside the original polygon',()=>{
  const coords=[[0,0],[10,0],[10,2],[2,2],[2,8],[10,8],[10,10],[0,10],[0,0]].map(([x,y])=>point('x',x,y).loc);
  assert.equal(core.staysWithin(coords,[coords[1],coords[6]]),false);
  assert.equal(core.staysWithin(coords,[coords[0],coords[7]]),true);
});

test('Real way 1297393997: simplify closed orchard inner without changing its forest relation',()=>{
  const source=JSON.parse(fs.readFileSync(require.resolve('./fixtures/way-1297393997.json'),'utf8'));
  const prefix={node:'n',way:'w',relation:'r'},s=setup();
  for(const e of source.elements){
    const item={...e,id:prefix[e.type]+e.id};
    if(e.type==='node')item.loc=[e.lon,e.lat];
    if(e.type==='way')item.nodes=e.nodes.map(id=>'n'+id);
    if(e.type==='relation')item.members=e.members.map(m=>({id:prefix[m.type]+m.ref,type:m.type,role:m.role}));
    s.change(entity(item));
  }
  s.select(['w1297393997']);s.c.perform(g=>g,'Loaded fixture');
  const before=s.c.graph(),relation=before.hasEntity('r21864055'),way=before.hasEntity('w1297393997');
  const p=s.request('preview',{tolerance:.5});assert.equal(p.ok,true);assert.equal(p.inner,true);assert.equal(p.beforeCount,23);assert.equal(p.afterCount,21);
  assert.equal(core.staysWithin(way.nodes.map(id=>before.hasEntity(id).loc),p.coordinates),true);
  assert.equal(s.request('apply',{token:p.token}).ok,true);
  assert.equal(s.c.graph().hasEntity('r21864055'),relation);assert.equal(s.c.graph().hasEntity('w1297393997').tags,way.tags);
  assert.equal(s.c.graph().hasEntity('w1297393997').nodes.length,22);
  assert.equal(s.request('undo').ok,true);assert.equal(s.c.graph(),before);
  const next=s.request('preview',{tolerance:1});assert.equal(next.afterCount,19);
  const changed=relation.update({members:relation.members.map(m=>m.id===way.id?{...m,role:'outer'}:m)});s.change(changed);
  assert.equal(s.request('apply',{token:next.token}).ok,false);
});
