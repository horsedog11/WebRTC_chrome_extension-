/* Shared, side-effect-free UI/worker helpers. Platform record parsing lives in Data Docker. */
(function(root) {
  'use strict';
  const approvedHosts = ['crm.pipelineventure.com', 'ninja.pipelineventure.com'];
  const gatewayOrigin = 'https://n8n.pipelineventure.com';
  const chatOrigin = 'https://chat.pipelineventure.com';
  function sourceURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !approvedHosts.includes(url.hostname)) return null;
      return url.href;
    } catch (_) { return null; }
  }
  function gatewayURL(value) {
    try {
      const url = new URL(value);
      if (url.origin !== gatewayOrigin || url.username || url.password || url.search || url.hash || url.pathname !== '/webhook/pv-extension') return null;
      return url.href;
    } catch (_) { return null; }
  }
  function chatURL(embedded=false) { return chatOrigin + (embedded ? '/?layout=embedded' : '/'); }
  function escapeVCard(value) { return String(value || '').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'); }
  function foldLine(line) {
    // RFC 6350: fold at <=75 UTF-8 octets without splitting a Unicode character.
    const encoder = new TextEncoder(); let lines=[], current='', bytes=0;
    for (const char of line) {
      const size=encoder.encode(char).length;
      if (bytes+size>75) { lines.push(current);current=' ';bytes=1; }
      current+=char;bytes+=size;
    }
    lines.push(current);return lines.join('\r\n');
  }
  function contactEmails(item) { return (item.data?.emails || []).filter(e => e.scope==='contact' && typeof e.address==='string'); }
  function contactPhones(item) { return (item.data?.phones || []).filter(p => p.scope==='contact' && typeof p.number==='string'); }
  function format(item, kind) {
    if (kind==='json') return JSON.stringify(item,null,2);
    const data=item.data || {}, emails=contactEmails(item),phones=contactPhones(item);
    const name=data.name || [data.first_name,data.last_name].filter(Boolean).join(' ') || 'Unnamed record';
    if (kind==='text') return [name,...emails.map(e=>e.address),...phones.map(p=>p.number),...(data.accounts || []).map(a=>a.name),item.source_url].filter(Boolean).join('\n');
    if (kind!=='vcard') throw new Error('Unknown clipboard format');
    if (!['contact','lead'].includes(item.record_type)) throw new Error('Select a person to copy a vCard. Account/client JSON remains available.');
    const lines=['BEGIN:VCARD','VERSION:4.0','FN:'+escapeVCard(name),
      'N:'+escapeVCard(data.last_name)+';'+escapeVCard(data.first_name)+';;;',
      ...emails.map(e=>'EMAIL:'+escapeVCard(e.address)),...phones.map(p=>'TEL;VALUE=text:'+escapeVCard(p.number))];
    if (item.source_url) lines.push('URL:'+escapeVCard(item.source_url));
    lines.push('END:VCARD');return lines.map(foldLine).join('\r\n')+'\r\n';
  }
  function safeItem(item) {
    if (!item || typeof item !== 'object' || !['suitecrm','ninja'].includes(item.platform) ||
        !['contact','lead','account','client'].includes(item.record_type) || typeof item.record_id!=='string' || !item.record_id || !item.data || typeof item.data!=='object' || Array.isArray(item.data)) return false;
    if (item.source_url && !sourceURL(item.source_url)) return false;
    const data=item.data;
    for(const key of ['name','first_name','last_name'])if(data[key]!=null&&typeof data[key]!=='string')return false;
    if(data.emails!=null&&(!Array.isArray(data.emails)||!data.emails.every(e=>e&&typeof e.address==='string'&&['contact','account'].includes(e.scope))))return false;
    if(data.phones!=null&&(!Array.isArray(data.phones)||!data.phones.every(p=>p&&typeof p.number==='string'&&['contact','account'].includes(p.scope))))return false;
    if(data.accounts!=null&&(!Array.isArray(data.accounts)||!data.accounts.every(a=>a&& (a.name==null||typeof a.name==='string'))))return false;
    return JSON.stringify(item).length<=50000;
  }
  root.Pipeline = {approvedHosts,gatewayOrigin,sourceURL,gatewayURL,chatURL,format,safeItem,contactEmails,contactPhones};
})(globalThis);
