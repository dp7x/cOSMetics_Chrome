const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const window=new EventTarget(),document=new EventTarget(),editor={graph(){}};
  document.documentElement={dataset:{}};
  let getContext;
  const api=Object.freeze({coreContext(){assert.equal(this,api);return editor;},osmNode:class{}});
  vm.runInNewContext(fs.readFileSync('src/id-bridge.js','utf8'),{
    window,document,CustomEvent,console,CosmeticsRedrawSegment:get=>{getContext=get;},
    CosmeticsSimplifyBridge(){},CosmeticsFixerBridge(){}
  });
  return {window,document,api,editor,context:()=>getContext()};
}
test('The startup bridge captures a context even when iD exports a frozen API',()=>{
  const f=setup();
  f.window.iD=f.api;
  assert.equal(f.window.iD.coreContext(),f.editor);
  assert.equal(f.context(),f.editor);
  assert.equal(f.window.iD.osmNode,f.api.osmNode);
  assert.equal(f.document.documentElement.dataset.cosmeticsIdBridge,'ready');
});
test('DOMContentLoaded repairs a replaced global before iD creates its context',()=>{
  const f=setup();
  Object.defineProperty(f.window,'iD',{value:f.api,writable:true,configurable:true});
  assert.equal(f.context(),undefined);
  f.window.dispatchEvent(new Event('DOMContentLoaded'));
  f.window.iD.coreContext();
  assert.equal(f.context(),f.editor);
});
