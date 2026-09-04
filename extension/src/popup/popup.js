'use strict';

/*
 * Popup: site access + the one remaining setting.
 *
 * The extension holds no host permissions until the user grants one here, per
 * site. chrome.permissions.request() must be called from a user gesture, so it
 * hangs off the Enable button and nothing else.
 */

const DEFAULTS = { userId: '' };
const AURENA_MARKER = '/main/ifsapplications/';

const $ = (id) => document.getElementById(id);
const show = (id, on) => { $(id).hidden = !on; };

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// --- site access ----------------------------------------------------------

let current = null; // { url, origin, pattern, host }

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/*
 * tab.url is readable here because of "activeTab", which is granted when the user
 * invokes the extension — clicking the icon counts. It carries no install-time
 * warning, unlike the "tabs" permission, and it is the whole reason this flow can
 * name the site before having permission for it.
 */
function describe(tab) {
  if (!tab || !tab.url || tab.url.indexOf(AURENA_MARKER) === -1) return null;
  try {
    const u = new URL(tab.url);
    if (u.protocol !== 'https:') return null;
    return { url: tab.url, origin: u.origin, pattern: u.origin + '/*', host: u.host };
  } catch (_) {
    return null;
  }
}

async function refreshSite() {
  const tab = await activeTab();
  current = describe(tab);

  show('siteNone', false);
  show('siteOffer', false);
  show('siteOn', false);

  if (!current) {
    show('siteNone', true);
    return;
  }

  const granted = await chrome.permissions.contains({ origins: [current.pattern] });
  if (granted) {
    $('onHost').textContent = current.host;
    show('siteOn', true);
    refreshWhoami();
  } else {
    $('offerHost').textContent = current.host;
    show('siteOffer', true);
  }
}

/*
 * Show who the extension thinks you are, so the override field below explains
 * itself instead of asking you to guess whether detection worked.
 */
async function refreshWhoami() {
  const el = $('whoami');
  const tab = await activeTab();
  if (!tab) return;

  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: 'sn-whoami' });
  } catch (_) {
    el.textContent = 'Not running on this tab yet — reload the page.';
    el.className = 'whoami warn';
    return;
  }

  if (resp && resp.detected) {
    el.textContent = 'Signed in as ' + resp.detected;
    el.className = 'whoami ok';
    $('fallbackWhy').textContent =
      'Detected from your IFS session, and used to sign notes. The override below is not needed.';
  } else if (resp && resp.effective) {
    el.textContent = 'Using the override: ' + resp.effective;
    el.className = 'whoami warn';
  } else {
    el.textContent = 'Could not detect your IFS user — set an override below.';
    el.className = 'whoami warn';
  }
}

async function enable() {
  if (!current) return;
  setStatus('');

  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [current.pattern] });
  } catch (err) {
    setStatus('Could not request access: ' + err.message, 'err');
    return;
  }
  if (!granted) {
    setStatus('Access was declined.', 'err');
    return;
  }

  // Register the content script and inject into tabs that are already open, so
  // there is no "now reload the page" step.
  try {
    await chrome.runtime.sendMessage({ type: 'sn-sync-sites' });
  } catch (_) {
    /* the worker reconciles on its own via permissions.onAdded */
  }

  await refreshSite();
  setStatus('Enabled. Checking the IFS setup…');
  // The grant is meaningless if the package was never imported — say so now
  // rather than letting the first note fail.
  await test();
}

async function revoke() {
  if (!current) return;
  await chrome.permissions.remove({ origins: [current.pattern] });
  await refreshSite();
  setStatus('Access removed. Notes already written stay in IFS.', 'ok');
}

// --- IFS setup check ------------------------------------------------------

/*
 * The popup cannot reach IFS itself — it is an extension page, so its fetches are
 * cross-origin and carry no session cookie. The content script is the only thing
 * on the right origin, so it runs the probe and reports back.
 */
async function test() {
  const tab = await activeTab();
  if (!tab) {
    setStatus('No active tab.', 'err');
    return;
  }

  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: 'sn-probe' });
  } catch (_) {
    setStatus('Not running on this tab yet — reload the page and try again.', 'err');
    return;
  }

  if (!resp || !resp.ok) {
    setStatus('Check failed: ' + ((resp && resp.error) || 'no response'), 'err');
    return;
  }

  const r = resp.report;
  console.info('[sticky] probe report', r);

  if (r.read !== 'ok') {
    setStatus(
      'CStickyNotes not reachable — ' + r.read + '\n' +
        (r.hint || 'Has the Application Configuration Package been imported in this environment?'),
      'err'
    );
    return;
  }
  if (r.write !== 'ok') {
    setStatus('Can read but not write — ' + r.write + '\n' + (r.hint || ''), 'err');
    return;
  }
  setStatus('CStickyNotes found, read and write both work.', 'ok');
  refreshWhoami();
}

// --- the one setting ------------------------------------------------------

async function loadSettings() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  $('userId').value = cfg.userId;
}

async function saveSettings() {
  await chrome.storage.sync.set({ userId: $('userId').value.trim() });
  // content.js picks this up through chrome.storage.onChanged — no reload needed.
  setStatus('Saved.', 'ok');
  refreshWhoami();
}

// --- wiring ---------------------------------------------------------------

$('guide').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/onboarding.html#setup') });
  window.close(); // the popup would sit over the page we just opened
});

$('enable').addEventListener('click', enable);
$('revoke').addEventListener('click', revoke);
$('test').addEventListener('click', () => { setStatus('Checking…'); test(); });
$('save').addEventListener('click', saveSettings);

loadSettings();
refreshSite();
