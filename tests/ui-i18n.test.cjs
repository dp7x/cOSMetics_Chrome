const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const sources=JSON.parse(fs.readFileSync(path.join(root,'ui-i18n-source.json'),'utf8'));
test('Panel translations preserve dynamic values and whitespace in all six languages',()=>{
 for(const lang of ['it','en','de','fr','es','sk']){
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'_locales',lang,'messages.json'),'utf8'));
  const context={chrome:{i18n:{getMessage:key=>catalog[key]?.message||''}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'ui-i18n.js'),'utf8'),context);
  for(const [source,key] of sources){
   const value=i=>'literal$'+i+'<b>value</b>';
   const input=source.replace(/\{(\d+)\}/g,(_,i)=>value(i));
   const expected=catalog[key].message.replace(/\{(\d+)\}/g,(_,i)=>value(i));
   assert.equal(context.CosmeticsUI.text('  '+input+'  '),'  '+expected+'  ',lang+': '+key);
  }
  assert.equal(context.CosmeticsUI.text('name=Avanti'), 'name=Avanti');
 }
});
test('Updated popup links use the same intended destinations in each language',()=>{
 for(const lang of ['it','en','de','fr','es','sk']){
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'_locales',lang,'messages.json'),'utf8'));
  assert(catalog.overtureDescription.message.includes('href="https://overturemaps.org/"'));
  assert(catalog.senseiDescription.message.includes('href="https://overpass-turbo.eu/"'));
  assert(catalog.commentDescription.message.includes('href="https://github.com/dp7x/cOSMetics_Chrome"'));
 }
});
