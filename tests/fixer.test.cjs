const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../fixer-core.js');

test('GeoJSON IDs, mixed OSM types, deduplication and invalid entries', () => {
  assert.deepEqual(core.parseList({type:'FeatureCollection',features:[
    {id:'way/123'}, {properties:{'@id':'node/14'}}, {id:'relation/30'}, {id:'way/123'}, null, {id:'123'}
  ]}), {ids:['w123','n14','r30'],duplicates:1,ignored:2});
  assert.deepEqual(core.parseList({elements:[{type:'relation',id:6},{type:'way',id:'8'},{type:'node',id:7}]}).ids,['r6','w8','n7']);
  assert.throws(() => core.parseList({type:'FeatureCollection',features:[]}));
  assert.throws(() => core.parseList({elements:[{type:'way',id:Number.MAX_SAFE_INTEGER+1}]}));
});

test('Free-form rules, equals inside values, duplicate keys and incomplete configuration', () => {
  assert.deepEqual(core.parseTags(' network:type=lwn\r\n\nwebsite=https://example.test/?a=b '),[['network:type','lwn'],['website','https://example.test/?a=b']]);
  for(const bad of ['building','building=','bad key=yes','x=1\nx=2','x='+ 'a'.repeat(256)])assert.throws(()=>core.parseTags(bad));
  assert.equal(core.rules('','').mode,'manual');
  assert.equal(core.rules('network:type=lwn','').mode,'remove');
  assert.throws(()=>core.rules('','ruins=yes'));
});

test('Replacement preserves unrelated tags; removal is conditional and conflicts are explicit', () => {
  const tags={building:'ruins',source:'survey',name:'Example'};
  const plan=core.inspect(tags,core.rules('building=ruins','building=yes\nruins=yes'));
  assert.equal(plan.canApply,true);
  assert.deepEqual(plan.after,{building:'yes',source:'survey',name:'Example',ruins:'yes'});
  assert.equal(tags.building,'ruins');
  const removal=core.inspect({'network:type':'lwn',route:'hiking',network:'lwn'},core.rules('network:type=lwn',''));
  assert.deepEqual(removal.after,{route:'hiking',network:'lwn'});
  assert.equal(core.inspect({building:'house'},core.rules('building=ruins','')).canApply,false);
  assert.equal(core.inspect({building:'ruins',ruins:'no'},core.rules('building=ruins','building=yes\nruins=yes')).canApply,false);
  assert.equal(core.inspect({a:'1',b:'different'},core.rules('a=1\nb=2','')).canApply,false);
  assert.equal(core.inspect({a:'1'},core.rules('a=1','a=1')).canApply,false);
  const prototype=core.inspect({},core.rules('',''));
  assert.deepEqual(Object.keys(prototype.after),[]);
});



function setup({ autoDraw = true, fittedZoom = 18, minimumZoom = 16 } = {}) {
  const handlers={}, replies=[], entities=new Map(), actions=[];
  let selected=[], mode='browse', loads=0;
  function entity(values) { return {...values,update(changes){return entity({...this,...changes})}}; }
  entities.set('w1',entity({id:'w1',type:'way',nodes:['n1','n2','n1'],version:9,tags:{building:'ruins',source:'survey'}}));
  entities.set('r2',entity({id:'r2',type:'relation',members:[{id:'w1',role:'outer',type:'way'}],version:5,tags:{'network:type':'lwn',route:'hiking'}}));
  const graph={hasEntity:id=>entities.get(id),replace(e){entities.set(e.id,e);return this}};
  const drawn=new Map(),trace=[];let zoom=18;
  const emit=full=>{trace.push(full?'draw-full':'draw-partial');for(const cb of [...drawn.values()])cb({full})};
  const map={on(name,cb){cb?drawn.set(name,cb):drawn.delete(name);return this},zoomTo(){zoom=fittedZoom;trace.push('move');if(autoDraw)setTimeout(()=>emit(true),2)},zoom(value){if(value===undefined)return zoom;zoom=value;trace.push('clamp-zoom');if(autoDraw)setTimeout(()=>emit(true),2);return this}};
  const context={graph:()=>graph,inIntro:()=>false,mode:()=>({id:mode}),selectedIDs:()=>selected,editable:()=>zoom>=minimumZoom,minEditableZoom:()=>minimumZoom,
    map:()=>map,enter(m){selected=m.ids||[];mode=m.id||'select';trace.push(mode==='browse'?'deselect':'select')},perform(action,note){action(graph);actions.push(note)},
    loadEntity(id,callback){loads++;setTimeout(()=>{const item=entity({id,type:'node',loc:[12,42],tags:{amenity:'bench'}});entities.set(id,item);callback(null,{data:[item]})},1)}};
  const sandbox={CosmeticsFixerCore:core,document:{addEventListener:(type,fn)=>handlers[type]=fn,dispatchEvent:e=>replies.push(JSON.parse(e.detail))},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},setTimeout,clearTimeout,requestAnimationFrame:cb=>setTimeout(cb,1),cancelAnimationFrame:clearTimeout};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/fixer-bridge.js'),'utf8'),sandbox);
  sandbox.CosmeticsFixerBridge(()=>context,()=>({modeSelect:(_c,ids)=>({ids}),modeBrowse:()=>({id:'browse',ids:[]})}));
  const request=async(action,data={})=>{const requestId=String(Math.random());await handlers['cosmetics:fixer-request']({detail:JSON.stringify({action,...data,requestId})});return replies.find(r=>r.requestId===requestId)};
  return {request,entities,actions,setMode:value=>mode=value,loads:()=>loads,emit,trace,selected:()=>selected,listeners:()=>drawn.size,zoom:()=>zoom};
}

test('Bridge applies one undoable action, preserves geometry, rejects stale tags and mismatches', async () => {
  const s=setup();let opened=await s.request('open',{id:'w1'});
  assert.equal(opened.ok,true);assert.equal(s.loads(),0);
  const before=s.entities.get('w1');
  let result=await s.request('apply',{id:'w1',expectedTags:opened.tags,searchText:'building=ruins',setText:'building=yes\nruins=yes'});
  assert.equal(result.ok,true);assert.equal(s.actions.length,1);
  assert.equal(s.entities.get('w1').nodes,before.nodes);assert.equal(s.entities.get('w1').version,9);
  result=await s.request('apply',{id:'w1',expectedTags:opened.tags,searchText:'building=ruins',setText:''});
  assert.equal(result.ok,false);assert.equal(s.actions.length,1);
  opened=await s.request('open',{id:'r2'});const members=s.entities.get('r2').members;
  result=await s.request('apply',{id:'r2',expectedTags:opened.tags,searchText:'network:type=lwn',setText:''});
  assert.equal(result.ok,true);assert.equal(s.entities.get('r2').members,members);assert.equal(s.entities.get('r2').tags.route,'hiking');
  assert(!Object.hasOwn(s.entities.get('r2').tags,'network:type'));
});

test('Bridge handles unloaded nodes, cancellation, changed selection and save mode', async () => {
  const s=setup();assert.equal((await s.request('open',{id:'n3'})).ok,true);assert.equal(s.loads(),1);
  const pending=s.request('open',{id:'n4'});await s.request('cancel');assert.equal((await pending).ok,false);
  const opened=await s.request('open',{id:'w1'});await s.request('open',{id:'r2'});
  assert.equal((await s.request('apply',{id:'w1',expectedTags:opened.tags,searchText:'building=ruins',setText:''})).ok,false);
  s.setMode('save');assert.equal((await s.request('open',{id:'w1'})).ok,false);assert.equal(s.actions.length,0);
});


test('Selection waits for a full redraw after the map move and cancels pending focus', async () => {
  const s=setup({autoDraw:false});
  let waiting=s.request('open',{id:'w1'});
  await new Promise(resolve=>setTimeout(resolve,1));
  assert.deepEqual(s.trace,['deselect','move']);assert.deepEqual(s.selected(),[]);
  s.emit(false);await new Promise(resolve=>setTimeout(resolve,3));assert.deepEqual(s.selected(),[]);
  s.emit(true);assert.equal((await waiting).ok,true);
  assert.deepEqual(s.trace,['deselect','move','draw-partial','draw-full','select']);
  assert.equal(s.selected()[0],'w1');assert.equal(s.listeners(),0);
  waiting=s.request('open',{id:'r2'});await new Promise(resolve=>setTimeout(resolve,1));
  await s.request('cancel');assert.equal((await waiting).ok,false);assert.deepEqual(s.selected(),[]);assert.equal(s.listeners(),0);
});



test('Forward filtering checks live tags before any map movement, requiring all search pairs', async () => {
  const s=setup();
  s.entities.get('w1').tags={building:'yes',ruins:'yes'};
  let result=await s.request('open',{id:'w1',filter:true,searchText:'building=ruins',setText:'building=yes\nruins=yes'});
  assert.equal(result.filtered,true);assert.deepEqual(s.trace,[]);
  result=await s.request('open',{id:'r2',filter:true,searchText:'network:type=lwn\nnetwork=rwn',setText:''});
  assert.equal(result.filtered,true);assert.deepEqual(s.trace,[]);
  result=await s.request('open',{id:'r2',filter:true,searchText:'network:type=lwn\nroute=hiking',setText:''});
  assert.equal(result.ok,true);assert.equal(result.filtered,undefined);assert.equal(s.selected()[0],'r2');
  result=await s.request('open',{id:'w1',filter:false,searchText:'building=ruins',setText:''});
  assert.equal(result.ok,true);assert.equal(result.filtered,undefined);assert.equal(s.selected()[0],'w1');
});




test('Large relations and ways are selected at the editor minimum zoom and remain editable', async () => {
  for(const id of ['w1','r2']) {
    const s=setup({fittedZoom:8,minimumZoom:17});
    const opened=await s.request('open',{id});assert.equal(opened.ok,true);assert.equal(s.zoom(),17);
    assert(s.trace.indexOf('clamp-zoom')<s.trace.indexOf('select'));
    const result=await s.request('apply',{id,expectedTags:opened.tags,searchText:id==='r2'?'network:type=lwn':'building=ruins',setText:''});
    assert.equal(result.ok,true);assert.equal(s.actions.length,1);
  }
  const close=setup({fittedZoom:19});await close.request('open',{id:'w1'});assert.equal(close.zoom(),19);assert(!close.trace.includes('clamp-zoom'));
});
