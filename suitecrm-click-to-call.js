// Delegation covers SuiteCRM's SPA and record/list views as they change.
// No page scan, number harvesting, external requests or page-message bridge.
(function() {
  'use strict';
  let pending = false;
  function notice() {
    let node = document.getElementById('pv-phone-click-notice');
    if (!node) {
      node = document.createElement('p');
      node.id = 'pv-phone-click-notice';
      node.setAttribute('role', 'alert');
      node.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:14px;background:#14202b;color:white;border:2px solid #72d8bd;border-radius:8px;font:14px system-ui';
      (document.body || document.documentElement).append(node);
    }
    node.textContent = 'PV Phone could not receive the number. Open the extension and dial it manually.';
    setTimeout(() => node.remove(), 8000);
  }
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const anchor = path.find(node => node?.tagName === 'A') || event.target?.closest?.('a[href]');
    if (!anchor || anchor.isContentEditable || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href') || '';
    if (!/^tel:/i.test(href)) return;
    let number;
    try { number = normalizeDialTarget(decodeURIComponent(href)); }
    catch (_) { return; }
    if (!number) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // A double-click should not hand a second tel navigation to the operating system.
    if (pending || event.detail > 1) return;
    pending = true;
    chrome.runtime.sendMessage({ target: 'suitecrm-click-to-call', number })
      .then(response => { if (!response?.ok) notice(); }, notice)
      .finally(() => { pending = false; });
  }, true);
})();
