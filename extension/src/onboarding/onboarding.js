'use strict';

/*
 * First-run setup page, opened once on install.
 *
 * It exists because a fresh install does nothing visible: the extension holds no
 * host permissions, and even once granted the notes need CStickyNotes to exist in
 * the customer's IFS environment. Without this page the first experience is a
 * button that never appears, followed by one that errors.
 *
 * GRANTING DOES NOT HAPPEN HERE. The popup has activeTab, so when the user is on
 * their IFS tab it already knows the origin and can offer "Enable on this site"
 * with nothing to type. This page used to carry an address field as a fallback;
 * it was removed, because asking someone to paste a URL the extension can read
 * itself is work we invented. This page only reports which sites are enabled and
 * lets them be removed.
 */

const $ = (id) => document.getElementById(id);

function setMsg(text, kind) {
  const el = $('grantMsg');
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
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

/*
 * Keep the list live: the user is told to enable the site from the popup, which
 * happens in another window while this page is still open. Without this they
 * would be looking at a stale "Not enabled anywhere yet".
 */
chrome.permissions.onAdded.addListener(() => refresh());
chrome.permissions.onRemoved.addListener(() => refresh());

refresh();
