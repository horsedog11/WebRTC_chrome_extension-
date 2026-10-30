const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const record={platform:'suitecrm',record_type:'contact',record_id:'record',source_url:'https://crm.pipelineventure.com/#/contacts/record/id',data:{first_name:'Sarah',last_name:'Example',emails:[{address:'sarah@example.test',scope:'contact'},{address:'billing@example.test',scope:'account'}],phones:[{number:'+13065550101',scope:'contact'},{number:'+13065550102',scope:'account'}]}};
function helpers(){const c=vm.createContext({URL,TextEncoder});vm.runInContext(fs.readFileSync(path.join(root,'pipeline.js'),'utf8'),c);return c.Pipeline;}
test('exact hosts, contact scope and UTF-8 vCard folding',()=>{
 const p=helpers();assert(p.sourceURL(record.source_url));
 for(const url of ['http://crm.pipelineventure.com/','https://crm.pipelineventure.com.evil/','https://user@crm.pipelineventure.com/','https://ninja.pipelineventure.com:444/'])assert.equal(p.sourceURL(url),null);
 assert.equal(p.gatewayURL('https://evil.test/webhook/pv-extension'),null);
 const v=p.format(record,'vcard');assert(v.includes('sarah@example.test'));assert(!v.includes('billing@example.test'));assert(!v.includes('+13065550102'));
 const item=JSON.parse(JSON.stringify(record));item.data.first_name='é'.repeat(100);item.data.last_name='Name; with, commas';
 for(const line of p.format(item,'vcard').split('\r\n'))assert(Buffer.byteLength(line)<=75);
 assert(p.format(item,'vcard').includes('Name\\; with\\, commas'));assert.throws(()=>p.format({...item,record_type:'client'},'vcard'));
});
function worker(){
 const session={},local={},menus=[],installed=[],clicked=[],messages=[],fetched=[];
 function storage(data){return {async get(keys){return typeof keys==='string'?{[keys]:data[keys]}:Object.fromEntries(keys.map(k=>[k,data[k]]));},async set(values){Object.assign(data,values);},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];},async setAccessLevel(){}};}
 const chrome={runtime:{id:'test',getURL:file=>'chrome-extension://test/'+file,onInstalled:{addListener:fn=>installed.push(fn)},onMessage:{addListener:fn=>messages.push(fn)},sendMessage:async()=>{}},contextMenus:{create:x=>menus.push(x),onClicked:{addListener:fn=>clicked.push(fn)}},action:{onClicked:{addListener(){}}},storage:{session:storage(session),local:storage(local)},permissions:{contains:async()=>true},windows:{getAll:async()=>[],create:async()=>({id:1})},offscreen:{}};
 const c=vm.createContext({chrome,crypto:{randomUUID:()=> 'id'},console,URL,TextEncoder,AbortSignal,Date,fetch:async(url,options)=>{fetched.push({url,options});return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({status:'success',results:[record]})};}});
 c.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c));vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),c);
 async function call(command,extra={},sender={id:'test',url:'chrome-extension://test/phone.html'}){return new Promise(resolve=>{for(const fn of messages){if(fn({target:'pipeline',command,...extra},sender,resolve)===true)return;}});}
 return {session,local,menus,installed,clicked,fetched,call};
}
test('worker preserves SPA links, stages read-only results, keeps tokens in session and blocks spoofed callers',async()=>{
 const w=worker();w.installed.forEach(fn=>fn());assert(w.menus.some(m=>m.id==='dial-selection'));assert(w.menus.some(m=>m.id==='pipeline-record-link'));
 assert((await w.call('session',{token:'r'.repeat(40)})).ok);
 await Promise.all(w.clicked.map(fn=>fn({menuItemId:'pipeline-record-link',linkUrl:record.source_url,pageUrl:'https://other.test'})));
 assert.equal(w.fetched.length,1);assert.equal(JSON.parse(w.fetched[0].options.body).url,record.source_url);assert.equal(w.session.pipelineClipboard.length,1);assert.equal(w.local.pipelineSessionToken,undefined);
 assert.equal((await w.call('search',{query:'Sarah'},{id:'test',url:'https://evil.test'})).ok,false);
 assert((await w.call('search',{query:'Sarah'})).ok);
 const count=w.fetched.length;assert.equal((await w.call('capture',{url:'https://evil.test/clients/id'})).ok,false);assert.equal(w.fetched.length,count);
 await w.call('disconnect');assert.equal(w.session.pipelineSessionToken,undefined);assert.equal(w.session.pipelineClipboard,undefined);
});
test('expired sessions do not call the gateway',async()=>{const w=worker();await w.call('session',{token:'r'.repeat(40)});w.session.pipelineTokenExpiresAt=Date.now()-1;assert.equal((await w.call('search',{query:'Sarah'})).ok,false);assert.equal(w.fetched.length,0);});
