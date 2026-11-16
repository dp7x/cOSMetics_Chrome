const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  class Element extends EventTarget{
    constructor(){super();this.style={};this.children=[];}
    append(...children){this.children.push(...children);}
    setAttribute(){}
    getBoundingClientRect(){return {left:0,top:0};}
    remove(){this.removed=true;}
  }
  const document=new EventTarget(),window=new EventTarget(),container=new Element();
  document.querySelector=()=>container;document.createElementNS=()=>new Element();
  const ids=['a','b','c','d','a'],tags={natural:'wood',name:'Test'};
  const way={id:'w1',type:'way',nodes:ids,tags,isArea:()=>true,isClosed:()=>true,update(change){return {...this,...change};}};
  const other={id:'w2',areAdjacent:(a,b)=>a==='a'&&b==='b'};
  let shared=false,status,active,native,closed=false,cursor;
  const modes=new Map(),moves=new Map();
  function graph(items){
    return {hasEntity:id=>items.get(id),parentRelations:()=>[],parentWays:()=>shared?[way,other]:[way],
      replace(entity){return graph(new Map(items).set(entity.id,entity));},remove(entity){const next=new Map(items);next.delete(entity.id);return graph(next);}};
  }
  const initial=graph(new Map([['w1',way],...[[0,0],[1,0],[1,1],[0,1]].map((loc,i)=>[ids[i],{id:ids[i],loc,type:'node'}])]));
  const stack=[initial];
  let mode={id:'select'};
  const proj=p=>p.map(x=>100+x*100);
  const map={on(k,fn){moves.set(k,fn);}};
  const context={editable:()=>true,mode:()=>mode,selectedIDs:()=>['w1'],graph:()=>stack.at(-1),projection:proj,
    surfaceRect:()=>({left:0,top:0}),map:()=>map,on(k,fn){modes.set(k,fn);},
    perform(fn){stack.push(fn(stack.at(-1)));},
    pop(){stack.pop();},
    enter(next){mode.exit?.();mode=next;for(const fn of modes.values())fn?.(mode);}
  };
  const api={modeDrawArea(c,id,start,button){
    assert.equal(c,context);assert.equal(id,'w1');assert.equal(start,initial);assert.equal(button,'area');
    return native={id:'draw-area',activeID:()=>cursor,exit(){if(!closed&&mode!==null)while(stack.at(-1)!==start)stack.pop();}};
  },modeSelect(){return {id:'select'};}};
  const sandbox={document,window,CustomEvent};
  vm.runInNewContext(fs.readFileSync('src/redraw-segment.js','utf8'),sandbox);
  sandbox.CosmeticsRedrawSegment(()=>context,()=>api);
  document.addEventListener('cosmetics:redraw-state',e=>{({key:status,active}=JSON.parse(e.detail));});
  const emit=(target,type,props={})=>target.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),props));
  return {
    start(){emit(document,'cosmetics:redraw-toggle');},
    click(x,y){emit(container.children.at(-1),'click',{clientX:x,clientY:y,button:0,detail:1});},
    key(key,options={}){const e=Object.assign(new Event('keydown',{cancelable:true}),{key,...options});window.dispatchEvent(e);return e.defaultPrevented;},
    share(){shared=true;},
    addPoint(id,temporary=false){
      context.perform(g=>{
        const w=g.hasEntity('w1'),nodes=w.nodes.slice();nodes.splice(-1,0,id);
        return g.replace({id,type:'node',loc:[0,.4]}).replace(w.update({nodes}));
      });
      if(temporary)cursor=id;
    },
    node:id=>context.graph().hasEntity(id),
    cancel(){emit(document,'cosmetics:redraw-cancel');},
    complete(){closed=true;context.enter({id:'select'});},
    change(){context.perform(g=>g.replace({...way,tags:{...tags,name:'Changed'}}));},
    way:()=>context.graph().hasEntity('w1'),original:way,mode:()=>mode,native:()=>native,
    entries:()=>stack.length,status:()=>status,active:()=>active,overlay:()=>container.children.at(-1)
  };
}
test('Rotates only the ring start, removes the overlay and hands drawing to native iD',()=>{
  const f=fixture();f.start();f.click(100,100);
  assert.equal(f.mode(),f.native());assert.equal(f.mode().isContinuing,true);
  assert.deepEqual(Array.from(f.way().nodes),['b','c','d','a','b']);
  assert.equal(f.way().id,'w1');assert.equal(f.way().tags,f.original.tags);
  assert(f.overlay().removed);
  assert.equal(f.key('z'),false);assert.equal(f.key('Escape'),false);assert.equal(f.key('Enter'),false);
  f.cancel();assert.equal(f.way(),f.original);assert.equal(f.active(),false);
});
test('Finishing without any added point removes the preparatory rotation',()=>{
  const f=fixture();f.start();f.click(100,100);assert.equal(f.entries(),2);
  f.complete();assert.equal(f.way(),f.original);assert.equal(f.entries(),1);
});
test('Existing closing edge needs no preparatory edit; shared or stale edges never start drawing',()=>{
  let f=fixture();f.start();f.click(100,200);assert.equal(f.mode().id,'draw-area');assert.equal(f.entries(),1);
  f=fixture();f.share();f.start();f.click(100,100);assert.equal(f.status(),'redrawShared');assert.equal(f.entries(),1);
  f=fixture();f.start();f.change();f.click(100,100);assert.equal(f.status(),'redrawChanged');assert.equal(f.mode().id,'select');
  f=fixture();f.start();assert.equal(f.key('Escape'),true);assert.equal(f.entries(),1);assert.equal(f.active(),false);
});

test('A click in the middle of an edge does not start drawing; a click near a vertex snaps to it',()=>{
  const f=fixture();f.start();f.click(145,100);
  assert.equal(f.mode().id,'select');assert.equal(f.entries(),1);assert.equal(f.active(),true);
  f.click(198,102);
  assert.equal(f.mode().id,'draw-area');
  assert.deepEqual(Array.from(f.way().nodes),['c','d','a','b','c']);
});

test('Ctrl+Z skips the temporary cursor and removes the original departure vertex',()=>{
  const f=fixture();f.start();f.click(100,200);f.addPoint('cursor',true);
  assert.equal(f.key('z',{ctrlKey:true}),true);
  assert.deepEqual(Array.from(f.way().nodes),['a','b','c','a']);
  assert.equal(f.node('d'),undefined);
  assert.equal(f.mode().id,'draw-area');assert.equal(f.status(),'redrawSteppedBack');
  assert.equal(f.key('z',{ctrlKey:true}),true);assert.equal(f.status(),'redrawCannotStepBack');
  f.cancel();assert.equal(f.way(),f.original);assert(f.node('d'));
});
test('Ordinary new vertices still use iD undo and linked departure vertices are protected',()=>{
  let f=fixture();f.start();f.click(100,200);f.addPoint('new');
  assert.equal(f.key('z',{ctrlKey:true}),false);
  f=fixture();f.start();f.click(100,200);f.share();
  assert.equal(f.key('z',{ctrlKey:true}),true);assert.equal(f.status(),'redrawProtectedPoint');
  assert.equal(f.way(),f.original);
});
test('Finishing after stepping back keeps the removal as a history entry',()=>{
  const f=fixture();f.start();f.click(100,200);f.key('z',{ctrlKey:true});f.complete();
  assert.deepEqual(Array.from(f.way().nodes),['a','b','c','a']);
  assert.equal(f.entries(),2);assert.equal(f.status(),'redrawDone');
});
