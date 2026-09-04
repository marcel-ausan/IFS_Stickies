'use strict';

/*
 * @-mention picker for sticky notes.
 *
 * Typing "@" in a note opens a person picker backed by the IFS person LOV. The
 * query is a same-origin, cookie-authenticated projection call — the same trick
 * as fetchFndUser() in content.js — so it needs no host permission and no bearer
 * token (see CLAUDE.md, "FND user is auto-detected via a cookie-authenticated
 * IFS call").
 *
 *   PersonHandling.svc/PersonInfoSet?$select=PersonId,Name,UserId
 *     &$filter=(UserId ne null) and contains(Name,'...')
 *
 * WHY THE UserId — NOT THE DISPLAY NAME — IS INSERTED INTO THE TEXT:
 *   - it is whitespace-free, so it survives arbitrary editing of the note and can
 *     be re-detected with a trivial regex;
 *   - Command_SYS.Mail takes a bare FND user name as a recipient and resolves it
 *     itself via Fnd_User_API.Get_Property(user,'SMTP_MAIL_ADDRESS'), so the token
 *     in the note IS the address — no e-mail is ever stored on our side;
 *   - somebody who knows an id can type "@ARC-JSMITH" by hand and it still works.
 *
 * The `(UserId ne null)` half of the filter is not cosmetic: persons without an
 * FND user (contacts, customer-side people, leavers) would be taggable but
 * unmailable, which fails silently. Keep it.
 *
 * Not every environment permits contains() on a projection, so search walks a
 * fallback ladder: contains -> startswith -> fetch-once-and-filter-locally. The
 * winning strategy is remembered for the rest of the page's life.
 */

window.SN = window.SN || {};

(function (SN) {
  const PROJECTION = '/main/ifsapplications/projection/v1/PersonHandling.svc/PersonInfoSet';
  const DEBOUNCE_MS = 200;
  const MIN_CHARS = 1;
  const MAX_RESULTS = 8;
  const CLIENT_FALLBACK_TOP = 500;
  const MENU_WIDTH = 260;
  const ITEM_HEIGHT = 30;

  // The token being typed, anchored at the caret.
  const TOKEN_RE = /@([A-Za-z0-9._@-]*)$/;

  const esc = (s) => String(s).replace(/'/g, "''");

  let strategy = null; // pinned once one works
  let clientCache = null;

  async function odata(filter, top) {
    const url =
      PROJECTION +
      '?$select=PersonId,Name,UserId' +
      '&$filter=' + encodeURIComponent(filter) +
      '&$top=' + top;

    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
      const err = new Error('LOV query failed: ' + res.status);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    return Array.isArray(body && body.value) ? body.value : [];
  }

  /*
   * Ordered ladder, tried until one does not 4xx.
   *
   * EVERY RUNG SEARCHES BOTH Name AND UserId. People type what they see, and
   * what they see in a note footer is the FND user ("JSMITH"), not the full
   * name — searching Name alone silently returns nothing for exactly the string
   * users are most likely to type.
   *
   * Case: names are mixed-case, FND user ids are upper-case, and OData contains()
   * is case-sensitive on Oracle. So rung 1 lowercases both sides of the Name test
   * via tolower() and upper-cases the UserId test. If tolower() is unsupported
   * the rung 400s and we drop to the case-sensitive variants; `client` is exact
   * but case-insensitive, and always works.
   */
  const STRATEGIES = [
    {
      name: 'contains-ci',
      run: (term) =>
        odata(
          "(UserId ne null) and (contains(tolower(Name),'" + esc(term.toLowerCase()) +
            "') or contains(UserId,'" + esc(term.toUpperCase()) + "'))",
          MAX_RESULTS
        )
    },
    {
      name: 'contains',
      run: (term) =>
        odata(
          "(UserId ne null) and (contains(Name,'" + esc(term) +
            "') or contains(UserId,'" + esc(term.toUpperCase()) + "'))",
          MAX_RESULTS
        )
    },
    {
      name: 'startswith',
      run: (term) =>
        odata(
          "(UserId ne null) and (startswith(Name,'" + esc(term) +
            "') or startswith(UserId,'" + esc(term.toUpperCase()) + "'))",
          MAX_RESULTS
        )
    },
    {
      name: 'client',
      run: async (term) => {
        if (!clientCache) clientCache = await odata('(UserId ne null)', CLIENT_FALLBACK_TOP);
        const t = term.toLowerCase();
        return clientCache
          .filter((p) => {
            const name = String(p.Name || '').toLowerCase();
            const uid = String(p.UserId || '').toLowerCase();
            return name.includes(t) || uid.includes(t);
          })
          .slice(0, MAX_RESULTS);
      }
    }
  ];

  async function searchPersons(term) {
    const ladder = strategy ? [strategy] : STRATEGIES;
    let lastErr = null;

    for (const s of ladder) {
      try {
        const rows = await s.run(term);
        // Pin only on a rung that actually returned somebody. A rung that is
        // accepted but silently matches nothing would otherwise get locked in
        // for the rest of the session on the strength of one empty search.
        if (!strategy && rows.length) {
          strategy = s;
          console.info('[sticky] person LOV strategy:', s.name);
        }
        if (rows.length || s === STRATEGIES[STRATEGIES.length - 1]) return rows;
      } catch (err) {
        lastErr = err;
        // 4xx means this environment rejects the filter shape — try the next rung.
        // 5xx/network is not the filter's fault, so stop rather than hammering the
        // server three times per keystroke.
        if (!(err.status >= 400 && err.status < 500)) break;
      }
    }

    if (lastErr) console.warn('[sticky] person lookup failed', lastErr);
    return [];
  }

  // Approximate the caret's viewport position by measuring a hidden mirror of the
  // textarea. Rendered inside our shadow root, so the Aurena DOM is never touched.
  function caretPoint(ta, root) {
    const box = ta.getBoundingClientRect();
    try {
      const cs = getComputedStyle(ta);
      const mirror = document.createElement('div');
      [
        'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderLeftWidth'
      ].forEach((p) => { mirror.style[p] = cs[p]; });
      mirror.style.cssText +=
        ';position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;top:0;left:0;';
      mirror.style.width = ta.clientWidth + 'px';
      mirror.textContent = ta.value.slice(0, ta.selectionStart);

      const marker = document.createElement('span');
      marker.textContent = '​';
      mirror.appendChild(marker);
      root.appendChild(mirror);
      const top = marker.offsetTop - ta.scrollTop;
      const left = marker.offsetLeft;
      mirror.remove();

      const lh = parseFloat(cs.lineHeight) || 18;
      return { x: box.left + left, y: box.top + top + lh };
    } catch (_) {
      return { x: box.left + 8, y: box.top + 24 };
    }
  }

  /*
   * Wire a textarea for @-mentions.
   *
   *   onPick(person) — called after a person is inserted; the caller persists.
   *
   * Returns a teardown function; call it before the note element is detached
   * (same discipline as the ResizeObserver — see CLAUDE.md).
   */
  function attach(opts) {
    const textarea = opts.textarea;
    const root = opts.root;
    const onPick = opts.onPick || function () {};

    let menu = null;
    let results = [];
    let selected = 0;
    let tokenStart = -1;
    let timer = null;
    let seq = 0;

    function close() {
      if (menu) { menu.remove(); menu = null; }
      results = [];
      selected = 0;
      tokenStart = -1;
    }

    function render(point) {
      if (!menu) {
        menu = document.createElement('div');
        menu.className = 'mention-menu';
        root.appendChild(menu);
      }
      menu.textContent = '';

      // An empty result used to close the menu, which is indistinguishable from
      // "the picker is broken". Say so instead.
      if (!results.length) {
        const none = document.createElement('div');
        none.className = 'mention-item mention-empty';
        none.textContent = 'No match — searches name and user id';
        menu.appendChild(none);
      }

      results.forEach((p, i) => {
        const item = document.createElement('div');
        item.className = 'mention-item' + (i === selected ? ' sel' : '');

        const name = document.createElement('span');
        name.className = 'mention-name';
        name.textContent = p.Name || p.PersonId || '';

        const uid = document.createElement('span');
        uid.className = 'mention-uid';
        uid.textContent = p.UserId || '';

        item.appendChild(name);
        item.appendChild(uid);
        // mousedown, not click: click fires after blur, by which time we've closed.
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(i);
        });
        menu.appendChild(item);
      });

      // Flip above the caret when there is no room below.
      const height = Math.min(results.length, MAX_RESULTS) * ITEM_HEIGHT + 8;
      const y = point.y + height > window.innerHeight ? point.y - height - 22 : point.y;
      menu.style.left = Math.max(4, Math.min(point.x, window.innerWidth - MENU_WIDTH - 4)) + 'px';
      menu.style.top = Math.max(4, y) + 'px';
    }

    function choose(index) {
      const person = results[index];
      if (!person || tokenStart < 0) return close();

      const token = '@' + person.UserId;
      const before = textarea.value.slice(0, tokenStart);
      const after = textarea.value.slice(textarea.selectionStart);
      const needsSpace = !after.startsWith(' ');

      textarea.value = before + token + (needsSpace ? ' ' : '') + after;
      const caret = before.length + token.length + (needsSpace ? 1 : 0);
      textarea.setSelectionRange(caret, caret);

      close();
      textarea.focus();
      onPick({ personId: person.PersonId, name: person.Name, userId: person.UserId });
    }

    function onInput() {
      const upto = textarea.value.slice(0, textarea.selectionStart);
      const m = upto.match(TOKEN_RE);
      if (!m) return close();

      tokenStart = textarea.selectionStart - m[0].length;
      const term = m[1];
      if (term.length < MIN_CHARS) return close();

      clearTimeout(timer);
      const mine = ++seq;
      timer = setTimeout(async () => {
        const rows = await searchPersons(term);
        if (mine !== seq) return; // a newer keystroke superseded this one
        console.debug('[sticky] mention search', term, '->', rows.length, 'hit(s)');
        results = rows;
        selected = 0;
        render(caretPoint(textarea, root));
      }, DEBOUNCE_MS);
    }

    function onKeyDown(e) {
      if (!menu) return;

      if (e.key === 'Escape') {
        close();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // With only the "no match" row showing there is nothing to navigate or
      // pick, so let Enter/Tab do their normal thing in the textarea.
      if (!results.length) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        selected = (selected + step + results.length) % results.length;
        render(caretPoint(textarea, root));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        choose(selected);
      } else {
        return;
      }
      // Keep Aurena's global key handling out of it while the menu is up.
      e.preventDefault();
      e.stopPropagation();
    }

    function onBlur() {
      setTimeout(close, 120);
    }

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('blur', onBlur);

    return function teardown() {
      clearTimeout(timer);
      close();
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('blur', onBlur);
    };
  }

  /*
   * Drop mentions whose token no longer appears in the text, so deleting "@X"
   * from a note un-tags X. Case-insensitive: FND user ids are upper-case, but
   * people type them however they like.
   */
  function sync(noteText, mentions) {
    const haystack = String(noteText || '').toLowerCase();
    return (mentions || []).filter(
      (m) => m && m.userId && haystack.includes('@' + String(m.userId).toLowerCase())
    );
  }

  SN.mentions = { attach, sync, searchPersons };
})(window.SN);
