const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(reverse=false,wide=false,mode="building",snap=mode!=="ortho",sharedWall=false){
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
  const building={id:'w1',type:'way',tags:{building:'house'},isClosed:()=>true,update(changes){return {...this,...changes};},nodes:reverse?['n0','n3','n2','n1','n0']:['n0','n1','n2','n3','n0']};
  function graph(items){
    return {items,parentRelations:()=>[],parentWays:()=>sharedWall?[{id:"w2",areAdjacent:(a,b)=>[a,b].includes("n0")&&[a,b].includes("n1")}]:[],hasEntity:id=>items.get(id),replace(e){const copy=new Map(items);copy.set(e.id,e);return graph(copy);}};
  }
  let g=graph(new Map([...oldNodes,building].map(e=>[e.id,e]))),counter=0,selected=[],actions=0,previous;
  const c={editable:()=>true,selectedIDs:()=>['w1'],mode:()=>({id:'browse'}),projection:Object.assign(p=>p,{invert:p=>p}),
    surfaceRect:()=>({left:0,top:0}),map:()=>({on(){}}),graph:()=>g,
    history:()=>({intersects:()=>snap?[g.hasEntity('w1')]:[]}),
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
  document.dispatchEvent(new Event('cosmetics:draw-'+mode+'-toggle'));
  function pointer(type,x,y,shiftKey=false){
    const e=new Event(type);Object.assign(e,{clientX:x,clientY:y,button:0,detail:1,shiftKey});
    map.children.at(-1).dispatchEvent(e);
  }
  return {click:(x,y,shift)=>pointer('click',x,y,shift),move:(x,y,shift)=>pointer('pointermove',x,y,shift),
    arc:()=>document.dispatchEvent(new Event("cosmetics:draw-arc-toggle")),
    escape:()=>window.dispatchEvent(Object.assign(new Event("keydown"),{key:"Escape"})),
    shift:down=>window.dispatchEvent(Object.assign(new Event(down?'keydown':'keyup'),{key:'Shift',shiftKey:down})),
    
    cancel:()=>document.dispatchEvent(new Event('cosmetics:draw-building-cancel')),
    graph:()=>g,selected:()=>Array.from(selected),actions:()=>actions,building,
    preview:()=>map.children.at(-1).children[0].attributes.points,
    edge:()=>map.children.at(-1).children[1].attributes,
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

test('Orthogonal drawing projects onto the first wall axes, merges straight extensions and permits diagonal closure',()=>{
  const f=fixture(false,false,'ortho');
  f.click(10,10);f.click(30,30);f.click(43,39); // extend along the diagonal axis
  f.move(24,55);
  assert.equal(f.edge().points,'41,41 25.5,56.5');
  f.click(24,55);
  f.move(12,12);assert.equal(f.marker().visibility,'visible');
  f.move(0,30);assert.equal(f.marker().visibility,'hidden');
  f.click(12,12);
  assert.equal(f.actions(),1);
  const way=f.graph().hasEntity(f.selected()[0]);
  assert.equal(way.tags.building,'yes');
  assert.equal(way.nodes.length,4);
  assert.equal(way.nodes.at(-1),way.nodes[0]);
  const ring=Array.from(way.nodes.slice(0,-1),id=>Array.from(f.graph().hasEntity(id).loc));
  assert.deepEqual(ring,[[10,10],[41,41],[25.5,56.5]]);
  assert.equal(f.graph().hasEntity('w1'),f.building);
});

test('Orthogonal drawing rejects a crossing and can be cancelled without editing',()=>{
  const f=fixture(false,false,'ortho');
  f.click(10,10);f.click(50,10);f.click(50,50);f.click(30,50);
  f.move(30,0);assert.equal(f.edge().stroke,'#c63535');f.click(30,0);
  assert.equal(f.preview(),'10,10 50,10 50,50 30,50');
  f.cancel();assert.equal(f.actions(),0);
});

test('Shift changes the preview immediately, and later edges use the original building axes',()=>{
  const f=fixture(false,false,'ortho');
  f.click(10,10);f.click(50,10);f.move(64,30);
  assert.equal(f.edge().points,'50,10 50,30');
  f.shift(true);assert.equal(f.edge().points,'50,10 64,30');
  f.shift(false);assert.equal(f.edge().points,'50,10 50,30');
  f.click(64,30,true);
  f.shift(false);f.move(28,38);
  assert.equal(f.edge().points,'64,30 28,30');
  f.click(28,38);f.click(10,10);
  assert.equal(f.actions(),1);
  const way=f.graph().hasEntity(f.selected()[0]);
  assert.deepEqual(Array.from(way.nodes,id=>Array.from(f.graph().hasEntity(id).loc)),
    [[10,10],[50,10],[64,30],[28,30],[10,10]]);
});

test('Shift allows a free angle but still rejects crossing or doubling back',()=>{
  const f=fixture(false,false,'ortho');
  f.click(10,10);f.click(50,10);f.click(50,50);
  f.move(50,32,true);assert.equal(f.edge().stroke,'#c63535');f.click(50,32,true);
  f.move(25,0,true);assert.equal(f.edge().stroke,'#c63535');f.click(25,0,true);
  assert.equal(f.preview(),'10,10 50,10 50,50');
  assert.equal(f.actions(),0);
});

test('Orthogonal drawing shares existing corner IDs and resumes its original axes after snapping',()=>{
  const f=fixture(false,false,'ortho',true);
  f.click(5,45);f.click(5,5);
  f.move(21,19);
  assert.equal(f.marker().visibility,'visible');
  assert.equal(f.edge().points,'5,5 20,20');
  f.click(21,19);
  f.move(35,39);
  assert.equal(f.marker().visibility,'hidden');
  assert.equal(f.edge().points,'20,20 20,39');
  f.click(35,39);f.click(5,45);
  assert.equal(f.actions(),1);
  const way=f.graph().hasEntity(f.selected()[0]);
  assert.equal(way.nodes[2],'n0');
  assert.equal(f.graph().hasEntity('w1'),f.building);
});

test('Orthogonal drawing can start on a shared node and keeps snapped corners on straight extensions',()=>{
  const f=fixture(false,false,'ortho',true);
  f.move(22,18);assert.equal(f.marker().visibility,'visible');f.click(22,18);
  f.click(61,19);f.click(85,20);f.click(85,0);f.click(20,0);f.click(21,19);
  assert.equal(f.actions(),1);
  const way=f.graph().hasEntity(f.selected()[0]);
  assert.equal(way.nodes[0],'n0');
  assert.equal(way.nodes[1],'n1');
  assert.equal(way.nodes.at(-1),'n0');
});

test('Orthogonal snapping inserts two shared nodes on one wall only at closure and in wall order',()=>{
  for(const reverse of [false,true]){
    const f=fixture(reverse,true,'ortho',true);
    f.click(100,15);f.click(45,16);f.click(45,0);f.click(100,0);
    assert.equal(f.graph().hasEntity('w1'),f.building);
    assert.equal(f.actions(),0);
    f.click(100,20);
    assert.equal(f.actions(),1);
    const way=f.graph().hasEntity(f.selected()[0]);
    const wall=Array.from(f.graph().hasEntity('w1').nodes);
    assert.deepEqual(wall,reverse?['n0','n3','n2','n1',way.nodes[0],way.nodes[1],'n0']:
      ['n0',way.nodes[1],way.nodes[0],'n1','n2','n3','n0']);
    assert.deepEqual(Array.from(f.graph().hasEntity(way.nodes[0]).loc),[100,20]);
    assert.deepEqual(Array.from(f.graph().hasEntity(way.nodes[1]).loc),[45,20]);
    f.undo();assert.equal(f.graph().hasEntity('w1'),f.building);
  }
});

test('An orthogonal segment can go oblique to snap to a wall, then be cancelled without splitting it',()=>{
  const f=fixture(false,true,'ortho',true);
  f.click(2,0);f.click(2,40);f.move(55,65);
  assert.equal(f.marker().visibility,'visible');
  assert.equal(f.edge().points,'2,40 55,60');
  f.click(55,65);f.cancel();
  assert.equal(f.actions(),0);
  assert.equal(f.graph().hasEntity('w1'),f.building);
});

test('Semicircle previews both sides, preserves the building and its diameter endpoints, and undoes in one step',()=>{
  const f=fixture(false,false,'arc');
  f.click(40,20);
  f.move(40,35);assert.equal(f.edge().stroke,'#ffb300');
  const inside=f.edge().points;
  f.move(40,4);assert.equal(f.edge().stroke,'#ffb300');
  assert.notEqual(f.edge().points,inside);assert.equal(f.actions(),0);
  f.click(40,4);
  const way=f.graph().hasEntity('w1');
  assert.equal(f.actions(),1);assert.deepEqual(f.selected(),['w1']);assert.equal(way.tags,f.building.tags);
  assert.equal(way.nodes[0],'n0');assert.equal(way.nodes.at(-4),'n1');
  for(const id of way.nodes.slice(1,-4)){
    const [x,y]=f.graph().hasEntity(id).loc;
    assert(y<20);assert(Math.abs(Math.hypot(x-40,y-20)-20)<1e-8);
  }
  f.undo();assert.equal(f.graph().hasEntity('w1'),f.building);
});

test('Semicircle refuses a shared wall and handles an arc replacing the closing edge',()=>{
  const blocked=fixture(false,false,'arc',true,true);
  blocked.click(40,20);assert.equal(blocked.edge().stroke,'#c63535');
  blocked.click(40,4);assert.equal(blocked.actions(),0);
  const f=fixture(false,false,'arc');
  f.click(20,40);f.click(5,40);
  assert.equal(f.actions(),1);
  const way=f.graph().hasEntity('w1');
  assert.deepEqual(Array.from(way.nodes.slice(0,4)),['n0','n1','n2','n3']);
  assert.equal(way.nodes.at(-1),'n0');
  assert(way.nodes.length>5);
});

test('Semicircle blocks an arc crossing the opposite wall and allows flipping to the valid side',()=>{
  const f=fixture(false,true,'arc');
  f.click(80,20);f.move(80,35);
  assert.equal(f.edge().stroke,'#c63535');f.click(80,35);assert.equal(f.actions(),0);
  f.move(80,5);assert.equal(f.edge().stroke,'#ffb300');f.click(80,5);
  assert.equal(f.actions(),1);
});

test('Ortho curves a fixed side and resumes the original axes without moving the arc endpoints',()=>{
  const f=fixture(false,false,'ortho');
  f.click(10,30);f.click(50,30);f.arc();
  f.move(30,45);const inward=f.edge().points;
  f.move(30,10);assert.notEqual(f.edge().points,inward);
  f.click(30,10);assert.equal(f.actions(),0);
  f.move(54,70);assert.equal(f.edge().points,'50,30 50,70');
  f.click(54,70);f.click(10,70);f.click(10,30);
  assert.equal(f.actions(),1);
  const way=f.graph().hasEntity(f.selected()[0]);
  const ring=Array.from(way.nodes,id=>Array.from(f.graph().hasEntity(id).loc));
  assert.deepEqual(ring.slice(-4),[[50,30],[50,70],[10,70],[10,30]]);
  assert(ring.slice(1,-4).every(([x,y])=>y<30&&Math.abs(Math.hypot(x-30,y-30)-20)<1e-8));
});

test('Ortho rejects an intersecting arc and Esc restores the draft side without ending the drawing',()=>{
  const f=fixture(false,false,'ortho');
  f.click(10,10);f.click(80,10);f.click(80,30);f.click(20,30);f.arc();
  f.move(50,5);assert.equal(f.edge().stroke,'#c63535');
  f.click(50,5);assert.equal(f.actions(),0);
  f.escape();assert.equal(f.preview(),'10,10 80,10 80,30 20,30');
  f.move(20,65);assert.equal(f.edge().points,'20,30 20,65');
});
