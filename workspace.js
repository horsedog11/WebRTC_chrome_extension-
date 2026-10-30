/* UI add-on. Uses the existing phone controls and read-only worker. */
(function() {
  'use strict';
  const $=id=>document.getElementById(id);
  let searchSequence=0,selectedPanel='phone';
  const send=async(command,extra={})=>{
    const result=await chrome.runtime.sendMessage({target:'pipeline',command,...extra});
    if(!result?.ok)throw new Error(result?.error || 'Pipeline did not reply.');
    return result;
  };
  function showPanel(name) {
    selectedPanel=name;
    for(const tab of document.querySelectorAll('[data-panel]')) {
      const active=tab.dataset.panel===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
      $(tab.dataset.panel+'-panel').hidden=!active;
    }
    if(name==='clipboard')loadClipboard();
    if(name==='chat'&&!$('rocket-frame').src)$('rocket-frame').src=Pipeline.chatURL(true);
    if(typeof scheduleResize==='function')scheduleResize();
    chrome.windows.getCurrent().then(current=>chrome.windows.update(current.id,{width:name==='chat'?560:name==='phone'?380:460})).catch(()=>{});
  }
  for(const tab of document.querySelectorAll('[data-panel]')) {
    tab.addEventListener('click',()=>showPanel(tab.dataset.panel));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      const tabs=[...document.querySelectorAll('[data-panel]')],index=tabs.indexOf(tab);
      const next=tabs[(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
      event.preventDefault();next.focus();showPanel(next.dataset.panel);
    });
  }
  function text(parent,tag,value,className) {
    const node=document.createElement(tag);node.textContent=String(value || '');if(className)node.className=className;parent.append(node);return node;
  }
  function button(parent,label,fn) {
    const node=document.createElement('button');node.type='button';node.textContent=label;node.addEventListener('click',async()=>{
      node.disabled=true;try{await fn();}catch(error){$('pipeline-status').textContent=error.message;}finally{node.disabled=false;}
    });parent.append(node);return node;
  }
  function card(item,clipboard=false) {
    const node=document.createElement('article');node.className='contact-card';
    const data=item.data || {};
    text(node,'h3',data.name || [data.first_name,data.last_name].filter(Boolean).join(' ') || 'Unnamed record');
    text(node,'p',`${item.platform==='ninja'?'Invoice Ninja':'SuiteCRM'} · ${item.record_type}`,'record-source');
    for(const account of data.accounts || [])text(node,'p',account.name,'record-source');
    for(const email of data.emails || [])text(node,'p',email.address+(email.scope==='account'?' (account email)':''));
    for(const phone of data.phones || []) {
      const row=document.createElement('div');row.className='contact-phone';
      text(row,'span',phone.number+(phone.scope==='account'?' (account phone)':''));
      if(phone.scope==='contact'&&normalizeDialTarget(phone.number))button(row,'Dial',async()=>{
        $('destination').value=normalizeDialTarget(phone.number);showPanel('phone');refresh();$('destination').focus();
      });node.append(row);
    }
    const actions=document.createElement('div');actions.className='contact-actions';node.append(actions);
    if(item.source_url&&Pipeline.sourceURL(item.source_url))button(actions,'Open record',()=>chrome.tabs.create({url:item.source_url}));
    if(!clipboard)button(actions,'Stage contact',async()=>{await send('stage',{items:[item]});$('pipeline-status').textContent='Added to Pipeline Clipboard.';});
    else {
      const select=document.createElement('select');select.setAttribute('aria-label','Copy format');
      for(const [value,label] of [['json','JSON'],['vcard','vCard'],['text','Text']]) {
        const option=document.createElement('option');option.value=value;option.textContent=label;
        option.disabled=value==='vcard'&&!['contact','lead'].includes(item.record_type);select.append(option);
      }
      actions.append(select);
      button(actions,'Copy to desktop',async()=>{await navigator.clipboard.writeText(Pipeline.format(item,select.value));$('pipeline-status').textContent='Copied to desktop clipboard.';});
      button(actions,'Remove',async()=>{await send('remove',{id:item.clipboard_id});await loadClipboard();});
    }
    return node;
  }
  async function loadClipboard() {
    try {
      const result=await send('clipboard');$('clipboard-items').replaceChildren();
      for(const item of result.pipelineClipboard || [])$('clipboard-items').append(card(item,true));
      $('clipboard-empty').hidden=!!result.pipelineClipboard?.length;
      if(result.pipelineNotice)$('pipeline-status').textContent=result.pipelineNotice;
      if(result.pipelineOpenPanel&&selectedPanel!==result.pipelineOpenPanel)showPanel(result.pipelineOpenPanel);
      if(typeof scheduleResize==='function')scheduleResize();
    } catch(error){$('pipeline-status').textContent=error.message;}
  }
  $('identity-search').addEventListener('submit',async event=>{
    event.preventDefault();const seq=++searchSequence;
    $('identity-results').replaceChildren();$('identity-search-status').textContent='Searching…';$('identity-search-button').disabled=true;
    try {
      const {result}=await send('search',{query:$('identity-query').value.trim()});if(seq!==searchSequence)return;
      for(const item of result.results)$('identity-results').append(card(item));
      $('identity-search-status').textContent=(result.status==='partial'?'Some sources are unavailable. ':result.status==='failed'?'Lookup unavailable. ':'')+
        (result.results.length?`${result.results.length} candidate record(s). Keep ambiguous matches separate.`:result.status==='success'?'No matching records.':'No confirmed search result.')+
        (result.truncated?' More matches exist; refine your search.':'');
      if(typeof scheduleResize==='function')scheduleResize();
    } catch(error){$('identity-search-status').textContent=error.message;}
    finally{if(seq===searchSequence)$('identity-search-button').disabled=false;}
  });
  $('clipboard-clear').addEventListener('click',async()=>{await send('clear');await loadClipboard();});
  $('pipeline-settings').addEventListener('submit',async event=>{
    event.preventDefault();
    const url=Pipeline.gatewayURL($('pipeline-gateway').value.trim());
    if(!url){$('pipeline-settings-status').textContent='Use the approved n8n Pipeline gateway.';return;}
    // Permission request happens directly inside this user gesture, before asynchronous settings writes.
    const granted=await chrome.permissions.request({origins:[Pipeline.gatewayOrigin+'/*']});
    if(!granted){$('pipeline-settings-status').textContent='Gateway permission was not granted.';return;}
    try {
      await chrome.storage.local.set({pipelineSettings:{gateway:url}});
      if($('pipeline-token').value.trim())await send('session',{token:$('pipeline-token').value.trim()});
      $('pipeline-token').value='';$('pipeline-settings-status').textContent='Settings saved. Session tokens remain in memory for up to one hour.';
    } catch(error){$('pipeline-token').value='';$('pipeline-settings-status').textContent=error.message;}
  });
  $('pipeline-disconnect').addEventListener('click',async()=>{
    searchSequence++;await send('disconnect');$('identity-search-button').disabled=false;$('identity-results').replaceChildren();await loadClipboard();$('pipeline-settings-status').textContent='Pipeline session and staged contacts cleared.';
  });
  $('chat-open').addEventListener('click',()=>chrome.tabs.create({url:Pipeline.chatURL()}));
  $('chat-reload').addEventListener('click',()=>{$('rocket-frame').src=Pipeline.chatURL(true);});
  chrome.runtime.onMessage.addListener(message=>{if(message?.target==='pipeline-refresh')loadClipboard(); if(message?.target==='dial-pending'||(message?.target==='phone-state'&&message.state?.incoming))showPanel('phone');});
  chrome.storage.local.get('pipelineSettings').then(({pipelineSettings={}})=>{$('pipeline-gateway').value=pipelineSettings.gateway || Pipeline.gatewayOrigin+'/webhook/pv-extension';});
  loadClipboard();
})();
