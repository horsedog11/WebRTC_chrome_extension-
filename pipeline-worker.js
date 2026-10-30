/* Read-only Pipeline Clipboard and identity search. No DOM injection or background page scraping. */
(function() {
  'use strict';
  let queue = Promise.resolve();
  const phoneURL = chrome.runtime.getURL('phone.html');
  chrome.storage.session.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'})?.catch(()=>{});
  chrome.runtime.onInstalled.addListener(() => {
    const patterns=Pipeline.approvedHosts.map(host=>'https://'+host+'/*');
    chrome.contextMenus.create({id:'pipeline-record-link',title:'Add contact to Pipeline Clipboard',contexts:['link'],targetUrlPatterns:patterns});
    chrome.contextMenus.create({id:'pipeline-record-page',title:'Add contact to Pipeline Clipboard',contexts:['page'],documentUrlPatterns:patterns});
  });
  function enqueue(fn) { const next=queue.then(fn);queue=next.catch(()=>{});return next; }
  async function options() {
    const {pipelineSettings={}}=await chrome.storage.local.get('pipelineSettings');
    const session=await chrome.storage.session.get(['pipelineSessionToken','pipelineTokenExpiresAt']);
    const url=Pipeline.gatewayURL(pipelineSettings.gateway || Pipeline.gatewayOrigin+'/webhook/pv-extension');
    if (!url) throw new Error('Configure the approved Pipeline gateway in settings.');
    if (!session.pipelineSessionToken || session.pipelineTokenExpiresAt<=Date.now()) throw new Error('Connect your read-only Pipeline session in settings.');
    if (!(await chrome.permissions.contains({origins:[Pipeline.gatewayOrigin+'/*']}))) throw new Error('Allow access to the Pipeline gateway in settings.');
    return {url,token:session.pipelineSessionToken,expiresAt:session.pipelineTokenExpiresAt};
  }
  async function request(body) {
    const {url,token,expiresAt}=await options();
    let response;
    try { response=await fetch(url,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify(body),signal:AbortSignal.timeout(20000)}); }
    catch (_) { throw new Error('Pipeline lookup could not be reached.'); }
    if (!response.ok) throw new Error(response.status===401||response.status===403 ? 'Pipeline session expired or access denied.' : 'Pipeline lookup is unavailable.');
    const declared=Number(response.headers.get('content-length') || 0);
    if(declared>250000) throw new Error('Pipeline result is too large.');
    const text=await response.text();if(text.length>250000)throw new Error('Pipeline result is too large.');
    let result;try{result=JSON.parse(text);}catch(_){throw new Error('Pipeline returned an invalid result.');}
    const active=await chrome.storage.session.get(['pipelineSessionToken','pipelineTokenExpiresAt']);
    if(active.pipelineSessionToken!==token||active.pipelineTokenExpiresAt!==expiresAt||expiresAt<=Date.now())throw new Error('Pipeline session ended during lookup.');
    if (!result || !['success','partial','failed','not_found','needs_review'].includes(result.status) || !Array.isArray(result.results) || result.results.length>50 || !result.results.every(Pipeline.safeItem)) throw new Error('Pipeline returned an unsupported result.');
    return result;
  }
  async function stage(items) {
    return enqueue(async()=>{
      await options();
      const {pipelineClipboard=[]}=await chrome.storage.session.get('pipelineClipboard');
      const records=Array.isArray(pipelineClipboard)?pipelineClipboard:[];
      for (const item of items) {
        if(!Pipeline.safeItem(item))throw new Error('Unsupported contact data.');
        const key=[item.platform,item.record_type,item.id_kind || 'native',item.record_id,item.parent_id || ''].join(':');
        const entry={...item,clipboard_id:key,collected_at:new Date().toISOString()};
        const index=records.findIndex(r=>r.clipboard_id===key);
        if(index>=0)records[index]=entry;else records.unshift(entry);
      }
      await chrome.storage.session.set({pipelineClipboard:records.slice(0,25)});
    });
  }
  async function capture(url) {
    const approved=Pipeline.sourceURL(url);
    if(!approved)throw new Error('Choose a supported SuiteCRM or Ninja record URL.');
    const result=await request({action:'capture',url:approved});
    if(result.status!=='success')throw new Error('Record could not be resolved. Check that this is a saved contact, lead, account or client.');
    await stage(result.results);
    await chrome.storage.session.set({pipelineNotice:'Contact data added to Pipeline Clipboard (up to 25 recent records).',pipelineOpenPanel:'clipboard'});
    await openPhone();
    chrome.runtime.sendMessage({target:'pipeline-refresh'}).catch(()=>{});
    return {ok:true,count:result.results.length};
  }
  chrome.contextMenus.onClicked.addListener(async info=>{
    if(!['pipeline-record-link','pipeline-record-page'].includes(info.menuItemId))return;
    try { await capture(info.menuItemId==='pipeline-record-link'?info.linkUrl:info.pageUrl); }
    catch(error) {
      await chrome.storage.session.set({pipelineNotice:error.message,pipelineOpenPanel:'clipboard'});
      await openPhone();chrome.runtime.sendMessage({target:'pipeline-refresh'}).catch(()=>{});
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.target!=='pipeline')return false;
    if(sender.url!==phoneURL || sender.id!==chrome.runtime.id){sendResponse({ok:false,error:'Untrusted extension caller'});return false;}
    (async()=>{
      switch(message.command) {
        case 'session': {
          const token=String(message.token || '').trim();
          if(!/^[A-Za-z0-9_.~-]{32,4096}$/.test(token))throw new Error('A valid scoped read-only user token is required.');
          await chrome.storage.session.set({pipelineSessionToken:token,pipelineTokenExpiresAt:Date.now()+3600000});return {ok:true};
        }
        case 'disconnect':
          await enqueue(()=>chrome.storage.session.remove(['pipelineSessionToken','pipelineTokenExpiresAt','pipelineClipboard','pipelineNotice']));return {ok:true};
        case 'search': {
          const query=String(message.query || '').trim();
          if(query.length<2||query.length>100)throw new Error('Enter 2–100 characters: name, phone, email or UUID.');
          return {ok:true,result:await request({action:'search',query})};
        }
        case 'capture':return capture(message.url);
        case 'stage':
          if(!Array.isArray(message.items)||message.items.length>25)throw new Error('Invalid clipboard selection.');
          await stage(message.items);return {ok:true};
        case 'clipboard': {
          const values=await chrome.storage.session.get(['pipelineClipboard','pipelineNotice','pipelineOpenPanel']);
          await chrome.storage.session.remove('pipelineOpenPanel');return {ok:true,...values};
        }
        case 'remove':
          await enqueue(async()=>{
            const {pipelineClipboard=[]}=await chrome.storage.session.get('pipelineClipboard');
            await chrome.storage.session.set({pipelineClipboard:pipelineClipboard.filter(x=>x.clipboard_id!==message.id)});
          });return {ok:true};
        case 'clear':await enqueue(()=>chrome.storage.session.remove(['pipelineClipboard','pipelineNotice']));return {ok:true};
        default:throw new Error('Unknown Pipeline action.');
      }
    })().then(sendResponse,()=>sendResponse({ok:false,error:'Pipeline operation failed. Check your session and gateway settings.'}));
    return true;
  });
})();
