const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(reverse=false,wide=false){
  class Element extends EventTarget{
    constructor(){super();this.children=[];this.style={};this.attributes={};}
    append(...items){this.children.push(...items);}
    setAttribute(key,value){this.attributes[key]=String(value);}
    getBoundingClientRect(){return {left:0,top:0};}
    remove(){this.removed=true;}
  }
  const document=new EventTarget(),window=new EventTarget(),map=new Element();
  document.querySelector=()=>map;document.createElementNS=()=>new Element();
  const node=(id,loc)=>({id,type:'node',loc});
  const points=wide?[[20,20],[140,20],[140,60],[20,60]]:[[20,20],[60,20],[60,60],[20,60]];
  const oldNodes=points.map((p,i)=>node('n'+i,p));
  const building={id:'w1',type:'way',tags:{building:'house'},nodes:reverse?['n0','n3','n2','n1','n0']:['n0','n1','n2','n3','n0']};
  function graph(items){
    return {items,hasEntity:id=>items.get(id),replace(e){const copy=new Map(items);copy.set(e.id,e);return graph(copy);}};
  }
  let g=graph(new Map([...oldNodes,building].map(e=>[e.id,e]))),counter=0,selected=[],actions=0,previous;
  const c={editable:()=>true,mode:()=>({id:'browse'}),projection:Object.assign(p=>p,{invert:p=>p}),
    surfaceRect:()=>({left:0,top:0}),map:()=>({on(){}}),graph:()=>g,
    history:()=>({intersects:()=>[g.hasEntity('w1')]}),
    perform(action){previous=g;g=action(g);actions++;},enter(mode){selected=mode.ids;}};
  const api={geoExtent(){},
    osmNode:class{constructor(o){Object.assign(this,o,{id:'newn'+(++counter),type:'node'});}},
    osmWay:class{constructor(o){Object.assign(this,o,{id:'neww'+(++counter),type:'way'});}},
    modeSelect:(_c,ids)=>({ids}),
    actionAddMidpoint:({edge},n)=>graph=>{
      graph=graph.replace(n);
      const way=graph.hasEntity('w1'),refs=[...way.nodes];
      const i=refs.findIndex((id,i)=>i<refs.length-1&&
        ((id===edge[0]&&refs[i+1]===edge[1])||(id===edge[1]&&refs[i+1]===edge[0])));
      assert(i>=0);refs.splice(i+1,0,n.id);return graph.replace({...way,nodes:refs});
    }};
  const sandbox={document,window,CustomEvent};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/draw-building.js'),'utf8'),sandbox);
  sandbox.CosmeticsDrawBuilding(()=>c,()=>api);
  document.dispatchEvent(new Event('cosmetics:draw-building-toggle'));
  function pointer(type,x,y){
    const e=new Event(type);Object.assign(e,{clientX:x,clientY:y,button:0,detail:1});
    map.children.at(-1).dispatchEvent(e);
  }
  return {click:(x,y)=>pointer('click',x,y),move:(x,y)=>pointer('pointermove',x,y),
    cancel:()=>document.dispatchEvent(new Event('cosmetics:draw-building-cancel')),
    graph:()=>g,selected:()=>Array.from(selected),actions:()=>actions,building,
    preview:()=>map.children.at(-1).children[0].attributes.points,
    marker:()=>map.children.at(-1).children[2].attributes,
    undo:()=>{g=previous;}};
}
test('Side corner snaps to a partial wall while the diagonal cursor is far away; new building is selected',()=>{
  const f=fixture();f.click(21,20);f.move(40,0);
  assert.equal(f.marker().cx,'40');assert.equal(f.marker().cy,'20');
  assert(f.preview());assert.equal(f.actions(),0);
  f.click(40,0);assert.equal(f.graph().hasEntity('w1'),f.building);
  f.click(40,5);assert.equal(f.actions(),1);
  const created=f.graph().hasEntity(f.selected()[0]);
  assert.equal(created.tags.building,'yes');
  assert.equal(created.nodes[0],'n0');
  const midpoint=created.nodes[1];
  assert(f.graph().hasEntity('w1').nodes.includes(midpoint));
  assert.deepEqual(Array.from(f.graph().hasEntity(midpoint).loc),[40,20]);
  assert.equal(created.nodes[0],created.nodes.at(-1));
  f.undo();assert.equal(f.graph().hasEntity('w1'),f.building);assert.equal(f.graph().hasEntity(midpoint),undefined);
});
test('Whole-wall snapping works for either source winding and reuses both endpoint IDs',()=>{
  for(const reverse of [false,true]){
    const f=fixture(reverse);f.click(20,20);f.move(60,-20);
    assert.equal(f.marker().cx,'60');assert.equal(f.marker().cy,'20');
    f.click(60,-20);f.click(60,10);
    const created=f.graph().hasEntity(f.selected()[0]);
    assert.equal(created.nodes[0],'n0');assert.equal(created.nodes[1],'n1');
    assert.equal(f.graph().hasEntity('w1'),f.building);
  }
});
test('A cursor on a wall does not snap unless a side vertex is near; free draw stays selected',()=>{
  const f=fixture();f.click(20,20);f.move(60,20);
  assert.equal(f.marker().visibility,'hidden');f.click(60,20);f.click(60,20);
  assert.equal(f.actions(),1);assert.equal(f.graph().hasEntity('w1'),f.building);
  const created=f.graph().hasEntity(f.selected()[0]);
  assert.equal(created.nodes[0],'n0');assert(!created.nodes.includes('n1'));
});
test('The other lateral vertex also snaps; cancelling changes neither nodes nor source way',()=>{
  const f=fixture();f.click(20,20);f.move(0,40);
  assert.equal(f.marker().cx,'20');assert.equal(f.marker().cy,'40');
  f.click(0,40);f.cancel();assert.equal(f.actions(),0);assert.equal(f.graph().hasEntity('w1'),f.building);
});

test('First point snaps to a wall 13 pixels away; both new shared nodes commit together and undo together',()=>{
  for(const reverse of [false,true]){
    const f=fixture(reverse,true);
    f.move(80,7);
    assert.equal(f.marker().cx,'80');assert.equal(f.marker().cy,'20');
    f.click(80,7);assert.equal(f.graph().hasEntity('w1'),f.building);
    f.move(100,0);assert.equal(f.marker().cx,'100');assert.equal(f.marker().cy,'20');
    f.click(100,0);assert.equal(f.actions(),0);
    f.click(100,10);assert.equal(f.actions(),1);
    const created=f.graph().hasEntity(f.selected()[0]),[a,b]=created.nodes;
    assert.deepEqual(Array.from(f.graph().hasEntity(a).loc),[80,20]);
    assert.deepEqual(Array.from(f.graph().hasEntity(b).loc),[100,20]);
    const original=f.graph().hasEntity('w1');
    assert(original.nodes.includes(a)&&original.nodes.includes(b));
    assert.equal(original.nodes.length,7);
    assert.equal(original.tags,f.building.tags);
    f.undo();assert.equal(f.graph().hasEntity('w1'),f.building);
    assert.equal(f.graph().hasEntity(a),undefined);assert.equal(f.graph().hasEntity(b),undefined);
  }
});
test('Cancel after the first point on a wall leaves the existing geometry intact',()=>{
  const f=fixture(false,true);f.click(80,9);f.click(100,0);f.cancel();
  assert.equal(f.actions(),0);assert.equal(f.graph().hasEntity('w1'),f.building);
});
test('Nearby existing corner keeps priority over the projection on the wall',()=>{
  const f=fixture();f.move(23,7);
  assert.equal(f.marker().cx,'20');assert.equal(f.marker().cy,'20');
});
test('First-point wall snap also creates a shared anchor in otherwise free drawing',()=>{
  const f=fixture(false,true);f.click(80,19);f.click(110,50);f.click(110,50);
  assert.equal(f.actions(),1);
  const created=f.graph().hasEntity(f.selected()[0]);
  assert(f.graph().hasEntity('w1').nodes.includes(created.nodes[0]));
  assert.equal(f.graph().hasEntity('w1').nodes.length,6);
});
