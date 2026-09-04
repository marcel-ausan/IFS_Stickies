'use strict';

/*
 * Extension settings.
 *
 * Content scripts can read chrome.storage directly, so there is no background
 * service worker and no message round-trip. (There used to be one: it existed
 * only to own the host permission and make fetches to a local Node service from
 * outside the Aurena page's CSP. Notes live in IFS now — every call is
 * same-origin from this very script — so both the worker and that permission
 * are gone.)
 */

window.SN = window.SN || {};

(function (SN) {
  /*
   * One setting. The old "enabled" flag is gone: revoking site access in the
   * popup is the real off switch, and clicking the FAB hides the notes — a third,
   * weaker toggle that also needed a page reload to take effect just read as
   * broken.
   */
  const DEFAULTS = {
    userId: '' // fallback only; the FND user is detected from the IFS session
  };

  SN.config = {
    async get() {
      try {
        return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
      } catch (err) {
        console.warn('[sticky] could not read settings, using defaults', err);
        return { ...DEFAULTS };
      }
    },
    DEFAULTS
  };
})(window.SN);
