'use strict';

/*
 * Sticky notes overlay.
 *
 * Renders draggable post-it cards on top of the Aurena page, scoped to the
 * record currently shown (see recordContext.js). All UI lives inside a Shadow
 * DOM so Aurena's styles can't bleed in and ours can't bleed out.
 */

(function (SN) {
  if (!SN || !SN.context || !SN.config || !SN.ifsStore) {
    console.error('[sticky] a content script did not load — check manifest.json script order');
    return;
  }
  if (window.__ifsStickyNotesLoaded) return; // guard against double-injection
  window.__ifsStickyNotesLoaded = true;

  /*
   * Notes live in the IFS CStickyNotes custom entity, reached same-origin with
   * the session cookie (see ifsStore.js). Nothing below this line talks to the
   * network directly.
   */
  const store = SN.ifsStore;

  /*
   * Eight note colours. Named rather than bare hex so the swatch tooltips say
   * something useful, and kept deliberately pale: note text is near-black and
   * has to stay readable on every one of them.
   */
  const COLORS = [
    { hex: '#fff7a8', name: 'Yellow' },
    { hex: '#ffd8a8', name: 'Orange' },
    { hex: '#ffd1dc', name: 'Pink' },
    { hex: '#e6d5ff', name: 'Purple' },
    { hex: '#bfe3ff', name: 'Blue' },
    { hex: '#c3f2ef', name: 'Teal' },
    { hex: '#c8f7c5', name: 'Green' },
    { hex: '#e4e6ea', name: 'Grey' }
  ];
  const SAVE_DEBOUNCE_MS = 600;
  const URL_POLL_MS = 700;

  // New-note geometry. Constants because addNote() positions from the top-right
  // corner, which needs the width to compute an x.
  const NOTE_W = 440;
  const NOTE_H = 360;
  const NOTE_MARGIN = 16;

  const state = {
    config: { userId: '' },
    context: null,
    notes: [],
    visible: true,
    lastHref: '',
    fndUser: ''
  };

  // --- shadow root + styles ------------------------------------------------

  const host = document.createElement('div');
  host.id = 'ifs-sticky-notes-host';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
  const shadow = host.attachShadow({ mode: 'open' });

  /*
   * Keep our keystrokes out of Aurena's global shortcuts.
   *
   * Aurena binds bare letters on the document — h (home), r (recent), b
   * (bookmarks), / (search), m, f — plus Alt+N / Alt+S. Its handler skips them
   * when you are typing in a field, by inspecting event.target.
   *
   * That guard cannot see our textarea. Events crossing a shadow boundary are
   * RETARGETED, so by the time they reach the document the target is this host
   * <div>, not the <textarea> inside it. Aurena sees a plain div, concludes you
   * are not typing, and fires the shortcut — which is why typing "h" in a note
   * navigated to the home page.
   *
   * Containing every key event that originates in our UI fixes it. Our own
   * handlers (the mention menu) live on inner elements and have already run by
   * the time the event bubbles out to here, so nothing of ours is lost.
   *
   * Residual limitation: this cannot stop a listener registered in the CAPTURE
   * phase on document or window, which runs before the event ever reaches us.
   * If some future Aurena shortcut still leaks through while typing, that is
   * why — and there is no fix from inside the shadow tree.
   */
  ['keydown', 'keypress', 'keyup'].forEach((type) => {
    host.addEventListener(type, (e) => e.stopPropagation());
  });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }

    .layer { position: fixed; inset: 0; pointer-events: none; }

    .fab {
      position: fixed; top: 54px; left: 50%;
      width: 64px; height: 64px;
      border-radius: 50%; border: none; cursor: grab; pointer-events: auto;
      background: #f5b301; color: #3a2e00; font-size: 28px; line-height: 64px;
      box-shadow: 0 3px 10px rgba(0,0,0,.3); transition: transform .1s;
      touch-action: none;
    }
    .fab:hover { transform: scale(1.06); }
    .fab.dragging { cursor: grabbing; transition: none; }

    .badge {
      position: absolute; top: -2px; right: -2px; min-width: 22px; height: 22px;
      padding: 0 5px; background: #d32f2f; color: #fff; border-radius: 11px;
      font-size: 12px; line-height: 22px; text-align: center; font-weight: 700;
      box-shadow: 0 1px 3px rgba(0,0,0,.4); pointer-events: none;
    }
    .badge.hidden { display: none; }

    .addbtn {
      position: absolute; bottom: -3px; right: -3px; width: 26px; height: 26px;
      border-radius: 50%; border: 2px solid #f5b301; background: #fff; color: #3a2e00;
      font-size: 20px; line-height: 22px; font-weight: 700; cursor: pointer; padding: 0;
      box-shadow: 0 1px 3px rgba(0,0,0,.4); pointer-events: auto;
    }
    .addbtn:hover { background: #fff7d6; }

    .note {
      position: fixed; pointer-events: auto; display: flex; flex-direction: column;
      border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,.28);
      min-width: 150px; min-height: 110px; overflow: hidden;
    }
    .note .head {
      height: 22px; cursor: move; display: flex; align-items: center; justify-content: flex-end;
      gap: 4px; padding: 0 6px; background: rgba(0,0,0,.06);
    }
    .note .swatch {
      width: 13px; height: 13px; border-radius: 50%; border: 1px solid rgba(0,0,0,.28);
      cursor: pointer; padding: 0; flex: none;
    }
    /* Which colour the note currently is. Without this, eight swatches give no
       feedback at all about the one already chosen. */
    .note .swatch.on {
      box-shadow: 0 0 0 2px rgba(0,0,0,.55);
      border-color: rgba(0,0,0,.55);
    }
    .note .footrow {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 10px; padding: 4px 8px 7px;
    }
    .note .footrow .foot { flex: 1 1 auto; padding: 0; }
    .note .notify {
      flex: 0 0 auto;
      border: none; background: #f5b301; color: #3a2e00; cursor: pointer;
      font-size: 14px; line-height: 1.1; font-weight: 700; padding: 8px 14px;
      border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.25);
      display: inline-flex; align-items: center; gap: 6px;
    }
    .note .notify:hover { background: #ffc93c; }
    .note .notify:active { transform: translateY(1px); }
    .note .notify:disabled { opacity: .55; cursor: default; box-shadow: none; }
    .note .del {
      border: none; background: transparent; cursor: pointer; font-size: 14px;
      line-height: 1; color: #7a2e2e; padding: 0 2px;
    }
    .note textarea {
      flex: 1; border: none; outline: none; resize: none; background: transparent;
      padding: 8px; font-size: 13px; color: #222; line-height: 1.35;
    }
    .note .foot { font-size: 10px; opacity: .55; padding: 2px 6px 4px; text-align: right; white-space: pre-line; }
    .palette { display: flex; gap: 4px; align-items: center; }
    .notes-hidden .note { display: none; }

    .mention-menu {
      position: fixed; z-index: 10; width: 260px; max-height: 248px; overflow-y: auto;
      background: #fff; border: 1px solid #cfcfcf; border-radius: 4px;
      box-shadow: 0 4px 14px rgba(0,0,0,.22); pointer-events: auto; padding: 4px 0;
    }
    .mention-item {
      display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
      height: 30px; padding: 0 10px; cursor: pointer; font-size: 13px; color: #222;
    }
    .mention-item.sel, .mention-item:hover { background: #fff2c2; }
    .mention-empty { opacity: .6; font-style: italic; cursor: default; }
    .mention-empty:hover { background: transparent; }
    .mention-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mention-uid { font-size: 11px; opacity: .6; flex: none; }
  `;
  shadow.appendChild(style);

  const layer = document.createElement('div');
  layer.className = 'layer';
  shadow.appendChild(layer);

  // Floating action button
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'IFS Sticky Notes';
  fab.textContent = '📝';
  const badge = document.createElement('span');
  badge.className = 'badge hidden';
  fab.appendChild(badge);
  const addFab = document.createElement('button');
  addFab.className = 'addbtn';
  addFab.textContent = '+';
  addFab.title = 'New note';
  fab.appendChild(addFab);
  shadow.appendChild(fab);

  function updateBadge() {
    const n = state.notes.length;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
    updateTooltip();
  }

  // Compose the FAB tooltip from context + user + count (replaces the old black toolbar text).
  function updateTooltip() {
    const parts = [];
    if (state.context && state.context.label) parts.push(state.context.label);
    const who = currentUser();
    if (who) parts.push('as ' + who);
    const n = state.notes.length;
    parts.push(n ? `${n} note${n === 1 ? '' : 's'}` : 'no notes');
    parts.push('click: show/hide · + : new note · drag to move');
    fab.title = parts.join('  —  ');
  }

  const FAB_SIZE = 64;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Compact local timestamp, e.g. "2026-06-03 18:48"
  function formatStamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Discreet created/updated attribution shown at the bottom of each note.
  function footText(note) {
    const created = [note.userId, formatStamp(note.createdAt)].filter(Boolean).join('  ·  ');
    let s = created ? 'Created  ' + created : '';
    // Show the "updated" line only once the note has actually been changed since creation.
    if (note.updatedBy && note.updatedAt && note.updatedAt !== note.createdAt) {
      const updated = [note.updatedBy, formatStamp(note.updatedAt)].filter(Boolean).join('  ·  ');
      s += (s ? '\n' : '') + 'Updated  ' + updated;
    }
    return s;
  }

  // --- FND user detection --------------------------------------------------
  // Aurena authenticates via OIDC and stores the signed-in user in web storage
  // (key "oidc.user:<authority>:<clientId>"). We read it from the page origin and
  // pull the login claim, which maps to the IFS FND_USER. Falls back to the popup
  // value if detection fails. NOTE: if the claim picked isn't the FND user on a
  // given IdP, adjust CLAIM_KEYS — the discovered claims are logged to the console.

  const CLAIM_KEYS = ['preferred_username', 'upn', 'unique_name', 'sub', 'name', 'email'];

  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(b64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function pickUserClaim(claims) {
    if (!claims) return '';
    for (const k of CLAIM_KEYS) {
      const v = claims[k];
      if (typeof v === 'string' && v) return k === 'email' ? v.split('@')[0] : v;
    }
    return '';
  }

  function detectFndUser() {
    // `bucket`, not `store` — the module-level `store` is the notes backend.
    for (const bucket of [sessionStorage, localStorage]) {
      for (let i = 0; i < bucket.length; i++) {
        const key = bucket.key(i);
        if (!key || key.indexOf('oidc.user:') !== 0) continue;
        try {
          const obj = JSON.parse(bucket.getItem(key));
          const claims = (obj && obj.profile) || decodeJwt((obj && (obj.access_token || obj.id_token)) || '');
          if (claims) console.info('[sticky] OIDC claims for FND user detection:', claims);
          const user = pickUserClaim((obj && obj.profile)) || pickUserClaim(decodeJwt((obj && obj.access_token) || ''));
          if (user) return user;
        } catch (_) {
          /* ignore malformed entries */
        }
      }
    }
    console.warn('[sticky] No OIDC session found in storage — falling back to popup User ID.');
    return '';
  }

  function currentUser() {
    return state.fndUser || state.config.userId || '';
  }

  // Cookie-authenticated GET against an IFS projection (same origin → session cookie rides along).
  async function ifsGet(path) {
    const r = await fetch('/main/ifsapplications/projection/v1/' + path, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = text;
    }
    return { status: r.status, body };
  }

  const looksLikeGuid = (s) => /^[0-9A-F]{32}$/i.test(s) || /^[0-9a-fA-F-]{36}$/.test(s);

  // Pull the FND user (login) out of the profile row — never a GUID.
  // GetProfileDetails() returns the current user's own profile, so Owner == current FND user.
  function extractUser(body) {
    if (body == null) return '';
    let v = body.value !== undefined ? body.value : body;
    if (Array.isArray(v)) v = v[0];
    if (typeof v === 'string') return looksLikeGuid(v) ? '' : v;
    if (v && typeof v === 'object') {
      for (const k of ['Owner', 'ModifiedBy', 'FndUser', 'UserId', 'Identity', 'User']) {
        if (typeof v[k] === 'string' && v[k] && !looksLikeGuid(v[k])) return v[k];
      }
    }
    return '';
  }

  // Resolve the current FND user via UserProfileService.GetProfileDetails() (cookie-authenticated).
  async function fetchFndUser() {
    try {
      const res = await ifsGet('UserProfileService.svc/GetProfileDetails()');
      const user = res.status === 200 ? extractUser(res.body) : '';
      if (user) console.info('[sticky] FND user resolved:', user);
      return user;
    } catch (_) {
      return '';
    }
  }

  // Cookie-authenticated IFS call (primary) → in-page OIDC scan → popup value.
  async function refreshFndUser() {
    let user = await fetchFndUser();
    if (!user) user = detectFndUser();
    state.fndUser = user || '';
    updateTooltip();
  }

  // Position the button, clamped to the viewport.
  function placeFab(x, y) {
    const cx = clamp(x, 4, window.innerWidth - FAB_SIZE - 4);
    const cy = clamp(y, 4, window.innerHeight - FAB_SIZE - 4);
    fab.style.left = cx + 'px';
    fab.style.top = cy + 'px';
    state.fabPos = { x: cx, y: cy };
  }

  // --- rendering -----------------------------------------------------------

  function paletteFor(note, el) {
    const wrap = document.createElement('span');
    wrap.className = 'palette';
    COLORS.forEach((c) => {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = c.hex;
      sw.title = c.name;
      sw.setAttribute('aria-label', c.name);
      sw.addEventListener('click', () => {
        note.color = c.hex;
        el.style.background = c.hex;
        wrap.querySelectorAll('.swatch').forEach((s2) => s2.classList.remove('on'));
        sw.classList.add('on');
        queueSave(note, { color: c.hex });
      });
      if ((note.color || COLORS[0].hex) === c.hex) sw.classList.add('on');
      wrap.appendChild(sw);
    });
    return wrap;
  }

  function renderNote(note) {
    const el = document.createElement('div');
    el.className = 'note';
    el.style.left = note.posX + 'px';
    el.style.top = note.posY + 'px';
    el.style.width = note.width + 'px';
    el.style.height = note.height + 'px';
    el.style.background = note.color || COLORS[0].hex;

    const head = document.createElement('div');
    head.className = 'head';
    head.appendChild(paletteFor(note, el));
    /*
     * Explicit send. The note itself is persisted on a 600ms debounce while the
     * user types, but the MAIL is only composed when this is pressed — otherwise
     * it goes out quoting a note that reads "@JSMITH " and nothing more.
     * Appears only when somebody is tagged who has not been mailed yet.
     */
    const notifyBtn = document.createElement('button');
    notifyBtn.className = 'notify';
    let sending = false;

    function refreshNotify() {
      const pending = store.notifyMentions && note.id ? pendingMentions(note) : [];
      notifyBtn.style.display = pending.length ? '' : 'none';
      // Now that it is a full-size button, label it as an action rather than a count.
      notifyBtn.textContent = '✉ Notify ' + pending.length;
      notifyBtn.title = 'Notify ' + pending.join(', ') + ' — sends the note as written now';
      notifyBtn.disabled = sending;
    }

    notifyBtn.addEventListener('click', async () => {
      const pending = pendingMentions(note);
      if (!pending.length || sending) return;
      sending = true;
      refreshNotify();
      try {
        // Flush the debounced text first, so the mail quotes what is on screen
        // rather than whatever the last autosave happened to catch.
        note.noteText = ta.value;
        await flushSave(note);
        const res = await store.notifyMentions(note.id, pending, note);
        note.notifiedUserIds = (res && res.notifiedUserIds) || pending;
        notifyBtn.textContent = '✓ Sent';
        setTimeout(() => { sending = false; refreshNotify(); }, 1500);
      } catch (err) {
        sending = false;
        refreshNotify();
        console.warn('[sticky] notify failed', err);
        alert('Sticky Notes: could not notify.\n' + err.message + '\n\nThe note itself is saved.');
      }
    });
    note._refreshNotify = refreshNotify; // appended to the footer row below

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Delete note';
    del.addEventListener('click', () => removeNote(note, el));
    head.appendChild(del);

    const ta = document.createElement('textarea');
    ta.value = note.noteText || '';
    ta.placeholder = 'Type a note…  (@ to mention someone)';
    ta.addEventListener('input', () => {
      note.noteText = ta.value;
      queueSave(note, { noteText: ta.value, mentions: syncNoteMentions(note) });
      refreshNotify(); // deleting an @token un-arms it again
    });

    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = footText(note);
    note._foot = foot; // so queueSave can refresh the "Updated …" line in place

    /*
     * Footer row: send on the left, attribution on the right. The button sits here
     * rather than in the header because it is the note's one deliberate action and
     * needs to be big enough to read as such — and because the footer is not a drag
     * handle, so it sidesteps the pointer-capture-eats-clicks problem entirely.
     */
    const footRow = document.createElement('div');
    footRow.className = 'footrow';
    footRow.appendChild(notifyBtn);
    footRow.appendChild(foot);

    el.appendChild(head);
    el.appendChild(ta);
    el.appendChild(footRow);

    makeDraggable(el, head, note);
    makeResizeObserved(el, note);

    // Same teardown discipline as the ResizeObserver: el._mt() before detaching.
    if (SN.mentions) {
      el._mt = SN.mentions.attach({
        textarea: ta,
        root: shadow,
        onPick: (person) => {
          note.noteText = ta.value;
          note.mentions = (note.mentions || [])
            .filter((m) => m.userId !== person.userId)
            .concat(person);
          queueSave(note, { noteText: ta.value, mentions: syncNoteMentions(note) });
          // Picking someone arms the ✉ button; it does NOT send. At this moment
          // the note usually reads "@JSMITH " and nothing else.
          refreshNotify();
        }
      });
    }

    refreshNotify(); // a reopened note may already have un-notified tags
    layer.appendChild(el);
    return el;
  }

  function renderAll() {
    layer.querySelectorAll('.note').forEach((n) => {
      if (n._ro) n._ro.disconnect();
      if (n._mt) n._mt();
      n.remove();
    });
    updateBadge();
    if (!state.visible) return;
    state.notes.forEach((n) => renderNote(n));
  }

  // --- interactions --------------------------------------------------------

  function makeDraggable(el, handle, note) {
    let startX, startY, originX, originY, dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      // Only drag from the bare header — never when grabbing a button (✕ / colour swatch),
      // otherwise pointer capture swallows their click.
      if (e.target !== handle) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originX = parseFloat(el.style.left);
      originY = parseFloat(el.style.top);
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nx = Math.max(0, originX + (e.clientX - startX));
      const ny = Math.max(0, originY + (e.clientY - startY));
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    });
    handle.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture(e.pointerId);
      note.posX = parseFloat(el.style.left);
      note.posY = parseFloat(el.style.top);
      queueSave(note, { posX: note.posX, posY: note.posY });
    });
  }

  function makeResizeObserved(el, note) {
    el.style.resize = 'both';
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return; // ignore the initial observation — only genuine user resizes should persist
      }
      if (!el.isConnected) return; // ignore fires caused by detaching during re-render
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (!w || !h) return; // ignore transient zero sizes
      if (w !== Math.round(note.width) || h !== Math.round(note.height)) {
        note.width = w;
        note.height = h;
        queueSave(note, { width: w, height: h });
      }
    });
    ro.observe(el);
    el._ro = ro; // so re-render can disconnect it before detaching
  }

  // --- persistence ---------------------------------------------------------

  /*
   * Keep note.mentions in step with the text: a mention whose "@USER" token has
   * been deleted is no longer a mention, so deleting the token un-tags them.
   * Saving mentions does NOT notify anybody — only the ✉ button does.
   */
  function syncNoteMentions(note) {
    note.mentions = SN.mentions
      ? SN.mentions.sync(note.noteText, note.mentions)
      : note.mentions || [];
    return note.mentions;
  }

  /*
   * Tagged in the text but not yet mailed. notifiedUserIds comes from the store
   * (Cf_Notifiedto), so it survives a reload and is shared between users — two
   * people editing the same note cannot double-notify the same person.
   */
  function pendingMentions(note) {
    const done = new Set((note.notifiedUserIds || []).map((u) => String(u).toUpperCase()));
    return syncNoteMentions(note)
      .map((m) => m.userId)
      .filter((u) => u && !done.has(String(u).toUpperCase()));
  }

  /*
   * Force the debounced save to happen now. Called before notifying so the mail
   * quotes what is on screen, not whatever the last autosave caught.
   */
  async function flushSave(note) {
    const pending = saveTimers.get(note.id);
    if (pending) {
      clearTimeout(pending);
      saveTimers.delete(note.id);
    }
    const updated = await store.updateNote(note.id, {
      noteText: note.noteText,
      mentions: syncNoteMentions(note),
      updatedBy: currentUser()
    });
    if (updated) {
      note.updatedAt = updated.updatedAt;
      note.updatedBy = updated.updatedBy;
      if (note._foot) note._foot.textContent = footText(note);
    }
  }

  const saveTimers = new Map();
  function queueSave(note, patch) {
    if (!note.id) return; // not yet persisted; create will capture latest state
    Object.assign(note, patch);
    clearTimeout(saveTimers.get(note.id));
    saveTimers.set(
      note.id,
      setTimeout(() => {
        // Stamp who changed it; the server stamps updated_at and returns the saved row.
        store
          .updateNote(note.id, { ...patch, updatedBy: currentUser() })
          .then((updated) => {
            if (!updated) return;
            note.updatedAt = updated.updatedAt;
            note.updatedBy = updated.updatedBy;
            if (note._foot) note._foot.textContent = footText(note);
          })
          .catch((err) => {
            // A failed autosave silently loses the user's typing. Say so in the
            // footer — a stale etag made every edit after the first vanish
            // without a trace until this was added.
            console.warn('[sticky] save failed', err);
            if (note._foot) note._foot.textContent = '⚠ NOT SAVED — ' + err.message;
          });
        saveTimers.delete(note.id);
      }, SAVE_DEBOUNCE_MS)
    );
  }

  async function addNote() {
    if (!state.context) return;
    if (!state.visible) {
      state.visible = true;
      layer.classList.remove('notes-hidden'); // a new note should always be visible
    }
    /*
     * Open near the top right. Aurena puts the record's own fields down the left
     * and centre of a Form page, so a note landing there covers the thing the
     * note is about. The right margin is the quietest part of the page.
     *
     * Successive notes cascade down-and-left from that corner rather than
     * down-and-right, which would walk them off the edge of the viewport.
     */
    const offset = state.notes.length * 22;
    const x = window.innerWidth - NOTE_W - NOTE_MARGIN - offset;
    const y = NOTE_MARGIN + offset;

    const draft = {
      recordKey: state.context.recordKey,
      luName: state.context.luName,
      keyRef: state.context.keyRef,
      pageUrl: location.href, // deep link used in mention notifications
      userId: currentUser(),
      noteText: '',
      mentions: [],
      color: COLORS[state.notes.length % COLORS.length].hex,
      posX: clamp(x, NOTE_MARGIN, Math.max(NOTE_MARGIN, window.innerWidth - NOTE_W - NOTE_MARGIN)),
      posY: clamp(y, NOTE_MARGIN, Math.max(NOTE_MARGIN, window.innerHeight - NOTE_H - NOTE_MARGIN)),
      width: NOTE_W,
      height: NOTE_H
    };
    try {
      const saved = await store.createNote(draft);
      state.notes.push(saved);
      updateBadge();
      const el = renderNote(saved);
      const ta = el.querySelector('textarea');
      if (ta) ta.focus();
    } catch (err) {
      console.warn('[sticky] create failed', err);
      alert(
        'Sticky Notes: could not save note.\n' + err.message + '\n\n' +
          'Store: ' + store.projection + '\n' +
          'Use "Test connection" in the extension popup for the full diagnosis.'
      );
    }
  }

  async function removeNote(note, el) {
    if (el._ro) el._ro.disconnect();
    if (el._mt) el._mt();
    el.remove();
    state.notes = state.notes.filter((n) => n.id !== note.id);
    updateBadge();
    if (note.id) {
      try {
        await store.deleteNote(note.id);
      } catch (err) {
        console.warn('[sticky] delete failed', err);
      }
    }
  }

  // --- record loading ------------------------------------------------------

  // Only show the button + notes on a record Form page (URL path /page/<x>/Form…).
  function isFormPage() {
    return /\/page\/[^/]+\/Form\b/.test(location.pathname);
  }

  // Show on Form pages, hide everywhere else (home, lobbies, lists). Runs on every
  // SPA navigation so it follows route changes without a full page reload.
  function onNavigate() {
    if (isFormPage()) {
      host.style.display = '';
      loadForCurrentRecord();
    } else {
      host.style.display = 'none';
    }
  }

  async function loadForCurrentRecord() {
    state.context = SN.context.parse();
    updateTooltip();

    try {
      // Notes are shared per record (not user-specific): list by recordKey only.
      // userId is still stored on create for attribution (shown in the note footer).
      const notes = await store.listNotes(state.context.recordKey);
      state.notes = Array.isArray(notes) ? notes : [];
    } catch (err) {
      console.warn('[sticky] load failed', err);
      state.notes = [];
    }
    renderAll();
  }

  function watchUrl() {
    state.lastHref = location.href;
    setInterval(() => {
      if (location.href !== state.lastHref) {
        state.lastHref = location.href;
        onNavigate();
      }
    }, URL_POLL_MS);
    window.addEventListener('popstate', () => onNavigate());
    window.addEventListener('hashchange', () => onNavigate());
  }

  // --- wiring --------------------------------------------------------------

  // Drag the button to reposition it; a tap (no real movement) shows/hides notes.
  let fabDrag = null;
  fab.addEventListener('pointerdown', (e) => {
    if (e.target !== fab) return; // pressing the + button must not start a drag
    fabDrag = {
      startX: e.clientX,
      startY: e.clientY,
      originX: parseFloat(fab.style.left) || 0,
      originY: parseFloat(fab.style.top) || 0,
      moved: false
    };
    fab.setPointerCapture(e.pointerId);
    fab.classList.add('dragging');
  });
  fab.addEventListener('pointermove', (e) => {
    if (!fabDrag) return;
    const dx = e.clientX - fabDrag.startX;
    const dy = e.clientY - fabDrag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) fabDrag.moved = true;
    placeFab(fabDrag.originX + dx, fabDrag.originY + dy);
  });
  fab.addEventListener('pointerup', (e) => {
    if (!fabDrag) return;
    fab.releasePointerCapture(e.pointerId);
    fab.classList.remove('dragging');
    const moved = fabDrag.moved;
    fabDrag = null;
    if (moved) {
      chrome.storage.local.set({ snFabPos: state.fabPos });
    } else {
      toggleVisibility(); // a tap on the button body shows/hides notes
    }
  });

  // The + button creates a note (it's a separate target, so it never starts a drag).
  addFab.addEventListener('click', (e) => {
    e.stopPropagation();
    addNote();
  });

  function toggleVisibility() {
    state.visible = !state.visible;
    layer.classList.toggle('notes-hidden', !state.visible);
    updateTooltip();
  }

  window.addEventListener('resize', () => {
    if (state.fabPos) placeFab(state.fabPos.x, state.fabPos.y);
  });

  /*
   * The popup cannot probe IFS itself — it is an extension page, so its fetches
   * are cross-origin and carry no session cookie. This content script is the
   * only thing on the right origin, so it runs the probe on request.
   */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return undefined;

    /*
     * Who does the extension think you are? The popup asks so it can show the
     * detected FND user instead of making you guess whether the manual override
     * is needed. `detected` is what IFS told us; `effective` is what actually
     * gets written to Cf_Createdby, which may be the typed fallback.
     */
    if (msg.type === 'sn-whoami') {
      sendResponse({ ok: true, detected: state.fndUser || '', effective: currentUser() });
      return undefined;
    }

    if (msg.type !== 'sn-probe') return undefined;
    if (!SN.ifsStore) {
      sendResponse({ ok: false, error: 'ifsStore did not load' });
      return undefined;
    }
    SN.ifsStore.probe()
      .then((report) => sendResponse({ ok: true, report }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // async response
  });

  /*
   * Apply a changed fallback user id without a page reload. It is the only
   * setting left, and telling someone to reload the tab to apply one text field
   * reads like the extension is broken.
   */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.userId) return;
    state.config.userId = changes.userId.newValue || '';
    updateTooltip();
  });

  async function init() {
    state.config = await SN.config.get();

    console.info('[sticky] store:', store.projection);
    document.documentElement.appendChild(host);

    // Resolve the FND user; the token may be captured just after load, so also react
    // to it landing in storage.
    await refreshFndUser();

    // Restore the button's last position, else default to top-centre.
    const stored = await chrome.storage.local.get({ snFabPos: null });
    if (stored.snFabPos) placeFab(stored.snFabPos.x, stored.snFabPos.y);
    else placeFab((window.innerWidth - FAB_SIZE) / 2, 54);

    onNavigate(); // show + load only if we're already on a Form page
    watchUrl();
  }

  init();
})(window.SN);
