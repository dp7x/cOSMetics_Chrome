const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('Bricks shows the tagging reminder after successful Overture additions with either event transport',()=>{
  const listeners=new Map();
  class Element{
    constructor(){this.style={};this.children=[];this.attributes={};}
    append(...nodes){this.children.push(...nodes);}
    after(){} replaceWith(){} remove(){}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(){}
  }
  const panel=new Element(),heading=new Element(),title=new Element(),load=new Element();
  panel.querySelector=()=>heading;heading.querySelector=()=>title;load.closest=()=>panel;
  const document={head:new Element(),querySelector:()=>load,createElement:()=>new Element(),
    addEventListener(type,fn){listeners.set(type,fn);}};
  const reminder='Created with building=yes. Complete known tags.';
  const api={i18n:{getMessage:key=>key==='drawCreated'?reminder:key}};
  const scope={document,chrome:api,browser:api,CosmeticsUI:{text:s=>s},MutationObserver:class{observe(){}}};
  vm.runInNewContext(fs.readFileSync('draw-building-control.js','utf8'),scope);
  const status=panel.children.find(node=>node.attributes.role==='status');
  assert(status);assert.equal(status.hidden,true);
  const receive=listeners.get('cosmetics:add-building-result');assert(receive);
  receive({detail:JSON.stringify({ok:false})});assert.equal(status.hidden,true);
  receive({detail:JSON.stringify({ok:true})});assert.equal(status.textContent,reminder);assert.equal(status.hidden,false);
  status.textContent='';status.hidden=true;
  receive({detail:{ok:true}});assert.equal(status.textContent,reminder);assert.equal(status.hidden,false);
  assert.doesNotThrow(()=>receive({detail:'invalid JSON'}));
});
