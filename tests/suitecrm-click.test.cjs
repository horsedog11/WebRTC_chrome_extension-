const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),root=path.join(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function content(){
 const dom=new JSDOM('<a id="phone" href="tel:%2B1%20(306)%20555-0101"><span>Phone</span></a>',{url:'https://crm.pipelineventure.com/#/contacts/record/test',runScripts:'outside-only'});
 let handler;const sent=[];dom.window.document.addEventListener=(type,fn,capture)=>{if(type==='click'){handler=fn;assert.equal(capture,true);}};
 dom.window.chrome={runtime:{sendMessage:async message=>{sent.push(message);return {ok:true};}}};
 dom.window.eval(fs.readFileSync(path.join(root,'dial.js'),'utf8'));dom.window.eval(fs.readFileSync(path.join(root,'suitecrm-click-to-call.js'),'utf8'));
 function click(extra={}){const anchor=dom.window.document.getElementById('phone');let prevented=false,stopped=false;
 handler({isTrusted:true,defaultPrevented:false,button:0,detail:1,composedPath:()=>[anchor.querySelector('span'),anchor],preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;},...extra});return {prevented,stopped};}
 return {dom,sent,click};
}
test('SuiteCRM tel click reaches PV Phone once, including SPA-added links and encoded numbers',async()=>{
 const c=content();assert.deepEqual(c.click(),{prevented:true,stopped:true});assert.deepEqual(c.click({detail:2}),{prevented:true,stopped:true});await tick();
 assert.equal(c.sent.length,1);assert.equal(c.sent[0].number,'+13065550101');assert.equal(c.sent[0].target,'suitecrm-click-to-call');
 c.dom.window.document.getElementById('phone').setAttribute('href','tel:205');c.click();await tick();assert.equal(c.sent[1].number,'205');c.dom.window.close();
});
test('synthetic, modified, non-phone and invalid dial clicks retain normal page behavior',async()=>{
 const c=content();for(const event of [{isTrusted:false},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}])assert.equal(c.click(event).prevented,false);
 for(const href of ['https://example.test','mailto:sarah@example.test','tel:205;ext=123','tel:bad','tel:%XX']){
  c.dom.window.document.getElementById('phone').setAttribute('href',href);assert.equal(c.click().prevented,false);
 }
 assert.equal(c.sent.length,0);c.dom.window.close();
});
test('background verifies SuiteCRM sender and reuses the single-consumer dial handoff',async()=>{
 let listener;const stored={};let opens=0;
 const chrome={runtime:{id:'test',getURL:file=>'chrome-extension://test/'+file,onInstalled:{addListener(){}},onMessage:{addListener:fn=>listener=fn},sendMessage:async()=>{}},
 contextMenus:{onClicked:{addListener(){}}},action:{onClicked:{addListener(){}}},storage:{session:{set:async value=>Object.assign(stored,value),get:async key=>({[key]:stored[key]}),remove:async key=>{delete stored[key];}}},
 windows:{getAll:async()=>[],create:async()=>{opens++;return{id:1};}}};
 const context=vm.createContext({chrome,URL,crypto:{randomUUID:()=> 'click-intent'},console});context.importScripts=file=>{if(file==='dial.js')vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);};
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
 const call=(message,sender)=>new Promise(resolve=>listener(message,sender,resolve));
 for(const sender of [{id:'other',url:'https://crm.pipelineventure.com/'},{id:'test',url:'https://crm.pipelineventure.com.evil/'},{id:'test',url:'http://crm.pipelineventure.com/'}])assert.equal((await call({target:'suitecrm-click-to-call',number:'205'},sender)).ok,false);
 assert.equal(opens,0);
 assert((await call({target:'suitecrm-click-to-call',number:'+1 (306) 555-0101'},{id:'test',url:'https://crm.pipelineventure.com/#/contacts/record/id'})).ok);
 assert.equal(opens,1);assert.equal(stored.dialIntent.number,'+13065550101');
 const first=await call({target:'background',command:'take-dial-intent'},{});assert.equal(first.intent.number,'+13065550101');
 assert.equal((await call({target:'background',command:'take-dial-intent'},{})).intent,null);
});
