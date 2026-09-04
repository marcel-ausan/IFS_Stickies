'use strict';

/*
 * First-run setup page, opened once on install.
 *
 * It exists because a fresh install does nothing visible: the extension holds no
 * host permissions, and even once granted it needs CStickyNotes to exist in the
 * customer's IFS environment. Without this page the first experience is a button
 * that never appears, followed by one that errors.
 *
 * Unlike the popup, this page has no active IFS tab to read an origin from, so
 * the user types their IFS address and we request permission for exactly that
 * origin. chrome.permissions.request() needs a user gesture, which the button
 * click supplies.
 */

const $ = (id) => document.getElementById(id);

function setMsg(text, kind) {
  const el = $('grantMsg');
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

/*
 * Accept what people actually paste: a bare host, a full Aurena deep link, with
 * or without a scheme. Everything after the origin is discarded — permission is
 * per-origin, and the content script is narrowed to the Aurena path separately.
 */
function toOrigin(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : 'https://' + text;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:') return null; // IFS Cloud is https; http would be a typo
    if (!u.hostname || u.hostname.indexOf('.') === -1) return null;
    return u.origin;
  } catch (_) {
    return null;
  }
}

async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => o.startsWith('https://'));
}

async function refresh() {
  let origins = [];
  try {
    origins = await grantedOrigins();
  } catch (err) {
    console.warn('[sticky] could not read permissions', err);
  }

  const list = $('siteList');
  list.textContent = '';
  $('noSites').hidden = origins.length > 0;

  origins.forEach((pattern) => {
    const host = pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '');

    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'host';
    name.textContent = host;

    const remove = document.createElement('button');
    remove.className = 'plain';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [pattern] });
      await refresh();
      setMsg('Removed ' + host + '. Notes already written stay in IFS.', 'ok');
    });

    li.appendChild(name);
    li.appendChild(remove);
    list.appendChild(li);
  });
}

async function grant() {
  const origin = toOrigin($('ifsUrl').value);
  if (!origin) {
    setMsg('That doesn’t look like a web address. Try something like https://yourcompany.ifs.cloud', 'err');
    return;
  }

  const pattern = origin + '/*';
  let ok = false;
  try {
    ok = await chrome.permissions.request({ origins: [pattern] });
  } catch (err) {
    setMsg('Could not request access: ' + err.message, 'err');
    return;
  }

  if (!ok) {
    setMsg('Access was declined, so the extension still won’t run there.', 'err');
    return;
  }

  // permissions.onAdded already queues registration in the worker; this is just
  // the faster path, and both are serialised there.
  try {
    await chrome.runtime.sendMessage({ type: 'sn-sync-sites' });
  } catch (_) {
    /* the worker reconciles on its own */
  }

  await refresh();
  setMsg('Enabled. Open a record page there and look for the 📝 button.', 'ok');
}

$('grant').addEventListener('click', grant);

$('ifsUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') grant();
});

// Prefill from an open IFS tab, if we happen to have access to one already.
(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*/main/ifsapplications/web/*' });
    if (tabs && tabs.length) $('ifsUrl').value = new URL(tabs[0].url).origin;
  } catch (_) {
    /* needs host access we may not have; the field just stays empty */
  }
  await refresh();
})();
