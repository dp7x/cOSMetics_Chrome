const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function page(){
  let listener;
  const context={chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'panel-session.js'),'utf8'),context);
  return {context,message(message){let response;listener(message,{},value=>response=value);return response;}};
}
test('Panel activation lasts only in the current page, without persistent storage',()=>{
  const first=page(),other=page(),seen=[];
  first.context.CosmeticsPanels.subscribe('overtureEnabled',value=>seen.push(value));
  assert.deepEqual(seen,[false]);
  first.message({kind:'cosmetics-panels',action:'set',key:'overtureEnabled',value:true});
  assert.deepEqual(seen,[false,true]);
  assert.equal(first.message({kind:'cosmetics-panels',action:'get'}).overtureEnabled,true);
  assert.equal(other.message({kind:'cosmetics-panels',action:'get'}).overtureEnabled,false);
  const reloaded=page();
  for(const key of ['overtureEnabled','fixerEnabled','simplifyEnabled']){
    assert.equal(reloaded.message({kind:'cosmetics-panels',action:'get'})[key],false);
  }
  first.message({kind:'cosmetics-panels',action:'set',key:'overtureEnabled',value:false});
  assert.deepEqual(seen,[false,true,false]);
});
test('Popup reads current state and toggles the active tab without changing preferences',async()=>{
  const editor=page();
  const inputs=Object.fromEntries(['overtureEnabled','fixerEnabled','simplifyEnabled'].map(id=>[id,{id,addEventListener(type,fn){this.change=fn;}}]));
  const context={document:{getElementById:id=>inputs[id]},chrome:{tabs:{
    query:async()=>[{id:42}],
    sendMessage:async(id,message)=>{assert.equal(id,42);return editor.message(message);}
  }}};
  const open=()=>vm.runInNewContext(fs.readFileSync(path.join(root,'fixer-popup.js'),'utf8'),context);
  open();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(inputs.fixerEnabled.checked,false);
  inputs.fixerEnabled.checked=true;await inputs.fixerEnabled.change();
  assert.equal(editor.message({kind:'cosmetics-panels',action:'get'}).fixerEnabled,true);
  open();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(inputs.fixerEnabled.checked,true);
  assert.equal(inputs.overtureEnabled.checked,false);
});
