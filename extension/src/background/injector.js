'use strict';

/*
 * Content-script registration.
 *
 * The extension ships with NO declarative content_scripts and NO granted host
 * permissions. Nothing runs anywhere until the user explicitly enables it for one
 * IFS site from the popup. That is a store-review decision as much as a privacy
 * one: an all-hosts `matches` entry is the single most common reason an extension
 * like this is rejected or held in extended review.
 *
 * So the flow is:
 *
 *   popup  ->  chrome.permissions.request({ origins: ['https://<their-ifs>/*'] })
 *   here   ->  register a content script for that origin, narrowed to the Aurena path
 *
 * Registration is persistent (persistAcrossSessions), so this worker is not in the
 * request path for anything — it exists only to keep registrations in step with
 * granted permissions. It does no network I/O at all.
 */

const SCRIPT_ID = 'sticky-notes';

// Narrowing to the Aurena path is deliberate and survives the move to optional
// permissions: the user grants a whole origin, but we still only inject where the
// app actually is. It also keeps us off the Keycloak login pages under
// /auth/realms/..., which used to show a stray sticky button on the sign-in screen.
const AURENA_PATH = '/main/ifsapplications/web/*';

const CONTENT_JS = [
  'src/content/recordContext.js',
  'src/content/config.js',
  'src/content/mentions.js',
  'src/content/ifsStore.js',
  'src/content/content.js'
];

// "https://host/*" (what permissions.getAll returns) -> "https://host/main/ifsapplications/web/*"
function toAurenaMatch(originPattern) {
  return String(originPattern).replace(/\/\*$/, '') + AURENA_PATH;
}

async function grantedMatches() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => o.startsWith('https://')).map(toAurenaMatch);
}

/*
 * Run registration work one at a time.
 *
 * Granting from the popup triggers TWO syncs: permissions.onAdded fires, and the
 * popup also sends sn-sync-sites so it can report back. Run concurrently, both
 * read "nothing registered", both call registerContentScripts, and the loser
 * throws "Duplicate script ID 'sticky-notes'". Worse than the noise: the losing
 * call might have been the one carrying newer matches.
 *
 * A failure must not poison the chain, so the tail is always a resolved promise.
 */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/*
 * Make the registered script match exactly the origins we currently hold. Called
 * on install, on browser start, and whenever a permission is added or revoked.
 */
async function syncRegistration() {
  const matches = await grantedMatches();

  let existing = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  } catch (_) {
    existing = [];
  }

  if (!matches.length) {
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      console.info('[sticky] no sites enabled — content script unregistered');
    }
    return;
  }

  const spec = {
    id: SCRIPT_ID,
    js: CONTENT_JS,
    matches,
    runAt: 'document_idle',
    persistAcrossSessions: true
  };

  try {
    if (existing.length) await chrome.scripting.updateContentScripts([spec]);
    else await chrome.scripting.registerContentScripts([spec]);
    console.info('[sticky] content script registered for', matches.join(', '));
  } catch (err) {
    // Belt and braces alongside serial(): registrations persist across sessions,
    // so getRegisteredContentScripts can also disagree with reality after a
    // reload. A duplicate id means it is already there — update it instead.
    if (/duplicate script id/i.test(String(err && err.message))) {
      try {
        await chrome.scripting.updateContentScripts([spec]);
        console.info('[sticky] content script updated for', matches.join(', '));
        return;
      } catch (err2) {
        console.error('[sticky] could not update content script', err2);
        return;
      }
    }
    console.error('[sticky] could not register content script', err);
  }
}

/*
 * Granting a permission does not retro-inject into tabs that are already open, and
 * telling someone to reload the tab they just enabled is a poor first impression.
 * Inject straight away instead.
 */
async function injectIntoOpenTabs() {
  const matches = await grantedMatches();
  if (!matches.length) return;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: matches });
  } catch (_) {
    return; // no permission for those tabs yet; the next navigation will pick it up
  }

  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_JS });
    } catch (err) {
      // Already injected, or the tab went away. Both are fine — content.js guards
      // re-injection with window.__ifsStickyNotesLoaded.
      console.debug('[sticky] inject skipped for tab', tab.id, err && err.message);
    }
  }
}

// Everything that touches registration goes through serial(), so the popup's
// explicit request and the permissions event cannot collide.
const syncAndInject = () => serial(async () => {
  await syncRegistration();
  await injectIntoOpenTabs();
});

chrome.runtime.onInstalled.addListener((details) => {
  serial(syncRegistration);

  /*
   * Show the setup page once, on first install only — not on update, where
   * reopening it every release would be an irritation rather than help.
   *
   * A fresh install is otherwise invisible: no host permissions means nothing
   * runs anywhere, and even once granted the notes need CStickyNotes to exist in
   * the customer's IFS environment. Without this page the first experience is a
   * button that never appears.
   */
  if (details && details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/onboarding.html#setup') });
  }
});
chrome.runtime.onStartup.addListener(() => serial(syncRegistration));

chrome.permissions.onAdded.addListener(syncAndInject);
chrome.permissions.onRemoved.addListener(() => serial(syncRegistration));

// The popup asks for this after a grant so it can report what actually happened.
// It is the same work permissions.onAdded already queues; serial() makes the
// second one a no-op-ish update rather than a duplicate-id failure.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'sn-sync-sites') return undefined;
  syncAndInject()
    .then(async () => sendResponse({ ok: true, matches: await grantedMatches() }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // async response
});
