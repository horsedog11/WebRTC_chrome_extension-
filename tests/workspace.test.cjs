const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),root=path.join(__dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
test('People renders untrusted text safely; staging is explicit; Chat and incoming-call navigation work',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(root,'phone.html'),'utf8'),{url:'chrome-extension://test/phone.html',runScripts:'outside-only'}),w=dom.window,sent=[],opened=[];let listener;
 const item={platform:'suitecrm',record_type:'contact',record_id:'record',source_url:'https://crm.pipelineventure.com/#/contacts/record/id',data:{name:'<img src=x onerror=alert(1)>',emails:[],phones:[],accounts:[]}};
 w.TextEncoder=TextEncoder;w.chrome={runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async msg=>{sent.push(msg);return msg.command==='search'?{ok:true,result:{status:'success',results:[item]}}:{ok:true,pipelineClipboard:[]};}},storage:{local:{get:async()=>({}),set:async()=>{}}},permissions:{request:async()=>true},windows:{getCurrent:async()=>({id:1}),update:async()=>{}},tabs:{create:async args=>opened.push(args)}};
 w.normalizeDialTarget=()=>null;w.scheduleResize=()=>{};
 w.eval(fs.readFileSync(path.join(root,'pipeline.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'workspace.js'),'utf8'));
 w.document.getElementById('tab-people').click();w.document.getElementById('identity-query').value='Sarah';w.document.getElementById('identity-search').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 const result=w.document.getElementById('identity-results');assert.equal(result.querySelector('img'),null);assert.equal(result.querySelector('h3').textContent,item.data.name);assert.equal(sent.filter(x=>x.command==='stage').length,0);
 [...result.querySelectorAll('button')].find(b=>b.textContent==='Stage contact').click();await tick();assert.equal(sent.filter(x=>x.command==='stage').length,1);
 w.document.getElementById('tab-chat').click();assert.equal(w.document.getElementById('rocket-frame').src,'https://chat.pipelineventure.com/?layout=embedded');w.document.getElementById('chat-open').click();await tick();assert.equal(opened[0].url,'https://chat.pipelineventure.com/');
 listener({target:'phone-state',state:{incoming:true}});assert.equal(w.document.getElementById('phone-panel').hidden,false);dom.window.close();
});
