'use strict';

/*
 * The note store: the CStickyNotes custom entity in IFS.
 *
 * Every call is SAME-ORIGIN with credentials:'include', exactly like
 * fetchFndUser(). That is why this extension needs no host_permissions, no CORS
 * handling, no background service worker and no server of any kind: the content
 * script is already authenticated as the signed-in IFS user and sees exactly
 * what IFS grants them.
 *
 * ── SHAPE, CONFIRMED AGAINST A LIVE RESPONSE ────────────────────────────────
 * A Custom LU's REST shape is not guessable from source; this is what the server
 * actually returns:
 *
 *   GET .../CustomProjectionCStickyNotes.svc/CStickyNotesSet
 *   { "value": [ { "@odata.etag": "W/\"…\"",
 *                  "Objkey": "5A9AB255098180E6E06325A2F20A9EC1",
 *                  "Cf_Noteid": "…", "Cf_Recordkey": "…", "Cf_Posx": "1", … } ] }
 *
 *   1. THE KEY IS Objkey, AND THE SERVER GENERATES IT. @odata.id is
 *      CStickyNotesSet(Objkey='…'). Cf_Noteid is just another column, so the
 *      client cannot choose the identity — create has to learn it from the
 *      response (see createNote).
 *   2. Custom fields are Cf_ prefixed and CASE-FLATTENED: Cf_Noteid, not
 *      Cf_NoteId. Every name goes through F below; never inline one.
 *   3. Numbers come back as STRINGS tagged #Decimal ("Cf_Posx": "1"), so every
 *      read is coerced.
 * ─────────────────────────────────────────────────────────────────────────────
 */

window.SN = window.SN || {};

(function (SN) {
  const ROOT = '/main/ifsapplications/projection/v1/';
  const SVC = 'CustomProjectionCStickyNotes.svc';
  const SET = 'CStickyNotesSet';

  // Every server-side field name lives here. One place to fix if the LU changes.
  const F = {
    key: 'Objkey', // framework key — server generated
    noteId: 'Cf_Noteid',
    recordKey: 'Cf_Recordkey',
    luName: 'Cf_Luname',
    keyRef: 'Cf_Keyref',
    pageUrl: 'Cf_Pageurl',
    noteText: 'Cf_Notetext',
    color: 'Cf_Color',
    posX: 'Cf_Posx',
    posY: 'Cf_Posy',
    width: 'Cf_Width',
    height: 'Cf_Height',
    createdBy: 'Cf_Createdby',
    createdDate: 'Cf_Createddate',
    updatedBy: 'Cf_Updatedby',
    updatedDate: 'Cf_Updateddate', // see NOTE ON UpdatedDate below
    mentions: 'Cf_Mentions',
    notifyTo: 'Cf_Notifyto', // recipients of the MOST RECENT send — what the event mails
    notifiedTo: 'Cf_Notifiedto', // cumulative; everyone already told. Drives "pending"
    notifySubject: 'Cf_Notifysubject',
    notifyBody: 'Cf_Notifybody',
    notifyTrigger: 'Cf_Notifytrigger'
  };

  /*
   * A Custom LU exposes no Rowversion, so there is no free "last changed"
   * timestamp — Cf_Updateddate is stamped by us on every write (see updateNote).
   * Without that the footer's "Updated <when>" would stay blank forever, since
   * Cf_Updatedby alone cannot fill it.
   */

  /*
   * No $select anywhere, deliberately: naming one field the LU does not have
   * 400s the whole query. The row is small and the server returns every column
   * by default, so listing them buys nothing and couples this file to the LU's
   * exact current shape — which has already changed once.
   */

  // OData string literals escape a single quote by doubling it.
  const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const keyUrl = (objkey) => `${SVC}/${SET}(${F.key}=${lit(objkey)})`;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  // --- CSRF ----------------------------------------------------------------

  function cookie(name) {
    const m = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Double-submit-cookie is the usual scheme. Send every pairing we find —
  // harmless if the server ignores them, saves guessing if one is required.
  function csrf() {
    const headers = {};
    for (const [c, h] of [
      ['XSRF-TOKEN', 'X-XSRF-TOKEN'],
      ['CSRF-TOKEN', 'X-CSRF-Token'],
      ['csrftoken', 'X-CSRFToken']
    ]) {
      const v = cookie(c);
      if (v) headers[h] = v;
    }
    return headers;
  }

  // --- transport -----------------------------------------------------------

  async function call(method, path, body, extraHeaders) {
    const headers = { Accept: 'application/json', ...csrf(), ...(extraHeaders || {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(ROOT + path, {
      method,
      credentials: 'include',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (res.status === 204) return null;

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = text; }
    }

    if (!res.ok) {
      const msg =
        (data && data.error && (data.error.message || data.error.Message)) ||
        (typeof data === 'string' && data.slice(0, 300)) ||
        `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /*
   * etags. The server returns @odata.etag per row and expects it back in
   * If-Match on PATCH/DELETE — the Objversion concurrency check. Cache what we
   * read so an edit sends the real value; '*' means "overwrite regardless".
   * Two people can have the same note open, so prefer the real etag and let a
   * 412 tell you to reload rather than silently clobbering their edit.
   */
  const etags = new Map();

  function rememberEtag(row) {
    if (row && row[F.key] && row['@odata.etag']) etags.set(row[F.key], row['@odata.etag']);
    return row;
  }

  const ifMatch = (id) => ({ 'If-Match': etags.get(id) || '*' });

  /*
   * Ask the server to send the updated row back, so a write refreshes the etag it
   * just invalidated. Without this a PATCH answers 204 with no body, our cached
   * etag stays at the value from listNotes, and the NEXT write fails 412
   * "Resource already modified" — silently, because queueSave only warns. Every
   * edit after the first was being dropped.
   */
  const PREFER_ROW = { Prefer: 'return=representation' };

  /*
   * Belt and braces: not every server honours Prefer. On a 412, drop the stale
   * etag, re-read the row, and try once more. If the re-read also fails, ifMatch
   * falls back to '*' and the write goes through unconditionally — losing the
   * concurrency check is better than losing the user's note.
   */
  async function patchRow(objkey, payload) {
    try {
      return await call('PATCH', keyUrl(objkey), payload, { ...ifMatch(objkey), ...PREFER_ROW });
    } catch (err) {
      if (err.status !== 412) throw err;
      console.warn('[sticky] etag was stale, refreshing and retrying');
      etags.delete(objkey);
      try {
        const fresh = await call('GET', keyUrl(objkey));
        rememberEtag(fresh && fresh.value ? fresh.value[0] : fresh);
      } catch (_) {
        /* fall through to If-Match: * */
      }
      return call('PATCH', keyUrl(objkey), payload, { ...ifMatch(objkey), ...PREFER_ROW });
    }
  }

  // --- mapping -------------------------------------------------------------

  function toClient(row) {
    if (!row) return null;
    return {
      id: row[F.key], // Objkey is the identity content.js uses
      noteId: row[F.noteId] || null, // client-side uuid, kept for reconciliation
      recordKey: row[F.recordKey],
      luName: row[F.luName],
      keyRef: row[F.keyRef],
      pageUrl: row[F.pageUrl],
      noteText: row[F.noteText] || '',
      color: row[F.color] || '#fff7a8',
      posX: num(row[F.posX]) ?? 80,
      posY: num(row[F.posY]) ?? 120,
      width: num(row[F.width]) ?? 440,
      height: num(row[F.height]) ?? 360,
      userId: row[F.createdBy],
      updatedBy: row[F.updatedBy],
      createdAt: row[F.createdDate] || null,
      updatedAt: row[F.updatedDate] || null,
      // Stored as a comma list, so only the user id survives the round trip.
      // That is all SN.mentions.sync() needs.
      mentions: String(row[F.mentions] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((userId) => ({ userId })),
      // Everyone already mailed. Survives reload and is shared between users, so
      // two people editing the same note cannot double-notify.
      notifiedUserIds: String(row[F.notifiedTo] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    };
  }

  function toIfs(n) {
    const out = {};
    const put = (field, v) => { if (v !== undefined) out[field] = v; };
    put(F.recordKey, n.recordKey);
    put(F.luName, n.luName);
    put(F.keyRef, n.keyRef);
    put(F.pageUrl, n.pageUrl);
    put(F.noteText, n.noteText);
    put(F.color, n.color);
    put(F.posX, n.posX);
    put(F.posY, n.posY);
    put(F.width, n.width);
    put(F.height, n.height);
    put(F.createdBy, n.userId);
    put(F.updatedBy, n.updatedBy);
    if (n.mentions !== undefined) {
      out[F.mentions] = (n.mentions || []).map((m) => m.userId).filter(Boolean).join(',');
    }
    return out;
  }

  // --- store ---------------------------------------------------------------

  const store = {
    // Surfaced so error messages can name what they were talking to.
    projection: SVC + '/' + SET,

    async listNotes(recordKey) {
      const path =
        `${SVC}/${SET}` +
        `?$filter=${encodeURIComponent(F.recordKey + ' eq ' + lit(recordKey))}` +
        `&$top=200`;
      const body = await call('GET', path);
      const rows = Array.isArray(body && body.value) ? body.value : [];
      rows.forEach(rememberEtag);
      return rows.map(toClient);
    },

    /*
     * The server owns the key, so unlike the Node store we cannot decide the id
     * up front. We still stamp our own uuid into Cf_Noteid: it costs nothing and
     * gives a way to find the row again if the POST answers 204 with no body.
     */
    async createNote(note) {
      const clientId = note.id || crypto.randomUUID();
      const payload = { [F.noteId]: clientId, ...toIfs(note) };
      const now = new Date().toISOString();
      if (payload[F.createdDate] === undefined) payload[F.createdDate] = now;
      if (payload[F.updatedDate] === undefined) payload[F.updatedDate] = now;

      const row = await call('POST', `${SVC}/${SET}`, payload, PREFER_ROW);
      if (row && row[F.key]) return toClient(rememberEtag(row));

      // 204, or a body without the key: recover the row by our own id.
      const found = await call(
        'GET',
        `${SVC}/${SET}?$filter=${encodeURIComponent(F.noteId + ' eq ' + lit(clientId))}&$top=1`
      );
      const created = found && found.value && found.value[0];
      if (!created) throw new Error('Note was created but could not be read back');
      return toClient(rememberEtag(created));
    },

    /*
     * Every write stamps Cf_Updateddate. The Custom LU has no Rowversion to lean
     * on, so if we don't set it nothing does, and the footer never shows when a
     * note last changed. (The Node store got this free — the server stamped
     * updated_at on every PUT.)
     */
    async updateNote(objkey, patch) {
      const payload = { ...toIfs(patch), [F.updatedDate]: new Date().toISOString() };
      const row = await patchRow(objkey, payload);
      if (row && row[F.key]) return toClient(rememberEtag(row));
      // 204: echo the patch back so the caller's footer refresh still works.
      return toClient({ [F.key]: objkey, ...payload });
    },

    async deleteNote(objkey) {
      try {
        await call('DELETE', keyUrl(objkey), undefined, ifMatch(objkey));
      } catch (err) {
        if (err.status !== 412) throw err;
        // Same stale-etag story as patchRow; the user asked for it gone.
        await call('DELETE', keyUrl(objkey), undefined, { 'If-Match': '*' });
      }
      etags.delete(objkey);
      return null;
    },

    /*
     * Send the notification for everyone still pending on this note.
     *
     * DELIBERATELY NOT CALLED ON PICK. A note is PATCHed on a 600ms debounce
     * while the user is still typing, so at the moment a person is chosen the
     * body is usually just "@JSMITH " — mailing then sends an empty note. The
     * user presses the note's ✉ button when the message is actually written, and
     * only that composes and sends.
     *
     * Nothing in IFS exposes Command_SYS.Mail over a projection and a browser has
     * no SMTP, so the split is:
     *
     *   HERE (JavaScript)      all the logic: who is pending, subject, body, link
     *   IFS (configuration)    a Custom Event on CStickyNotes with an E-Mail
     *                          action, sending verbatim what these fields hold
     *
     * No PL/SQL, no scheduled task, no projection action.
     *
     * Cf_Notifytrigger carries a fresh timestamp per send and the Custom Event
     * MUST be conditioned on it CHANGING — that fires each send exactly once
     * while ordinary edits (which never write these fields) fire nothing.
     *
     * Cf_Notifyto is only this send's recipients (what the event mails);
     * Cf_Notifiedto accumulates everyone ever told, so re-sending after adding
     * one more person does not spam the people already notified.
     *
     * Accepted cost: no retry. If this PATCH fails nobody is notified — but
     * because it is now an explicit button, the user sees the error and can
     * press it again.
     */
    async notifyMentions(objkey, userIds, note) {
      const list = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
      if (!list.length) return null;

      const already = (note && note.notifiedUserIds) || [];
      const union = Array.from(new Set([...already, ...list]));
      const msg = store.buildMessage(note || {}, list);

      const row = await patchRow(objkey, {
        [F.notifyTo]: list.join(','), // Command_SYS.Mail tokenises on comma
        [F.notifiedTo]: union.join(','),
        [F.notifySubject]: msg.subject,
        [F.notifyBody]: msg.body,
        [F.notifyTrigger]: new Date().toISOString()
      });
      if (row && row[F.key]) rememberEtag(row);

      return { notified: list, notifiedUserIds: union };
    },

    /*
     * Compose the mail. Shaped after FndObjSubscriptionUtil.Send_Email___ in
     * fndbas: what happened, the deep link, then the note itself. Separate from
     * the send so it is testable without a server, and so wording changes never
     * touch IFS.
     *
     * THE BODY IS HTML. The Custom Event's E-Mail action renders it as such, so a
     * plain-text body arrived as one run-on paragraph — every "\n" collapsed. Line
     * breaks therefore have to be <br>, including the ones the user typed inside
     * the note.
     *
     * Everything interpolated is escaped. Note text is user input and reaches a
     * colleague's mail client, so an unescaped "<" is both a rendering bug and an
     * injection route. Styles are inline because mail clients drop <style> blocks.
     *
     * If a future environment sends the body as text/plain instead, the tags will
     * show up literally — that is the signal to go back to "\n".
     */
    buildMessage(note, recipients) {
      const esc = (s) =>
        String(s == null ? '' : s).replace(
          /[&<>"']/g,
          (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
        );

      const who = note.updatedBy || note.userId || 'Someone';
      const where = note.luName || note.recordKey || 'a record';
      const key = note.keyRef ? ' ' + note.keyRef : '';
      const link = note.pageUrl || (typeof location !== 'undefined' ? location.href : '');

      const text = String(note.noteText || '').trim() || '(empty)';
      const noteHtml = esc(text).replace(/\r?\n/g, '<br>');

      const parts = [
        `<p>${esc(who)} mentioned you in a note on <b>${esc(where)}${esc(key)}</b>.</p>`
      ];
      if (link) {
        // The URL is its own link text: if a client strips the anchor, the address
        // is still readable and copyable.
        parts.push(`<p><a href="${esc(link)}">${esc(link)}</a></p>`);
      }
      parts.push(
        '<p><b>Note:</b></p>',
        '<div style="border-left:3px solid #f5b301;background:#fffbe8;' +
          'padding:8px 14px;margin:0 0 12px;font-family:Segoe UI,Arial,sans-serif;">' +
          noteHtml +
          '</div>'
      );

      return {
        to: recipients.join(','),
        subject: `You were mentioned on ${where}${key}`,
        body: parts.join('\n')
      };
    },

    /*
     * Run from the console on an Aurena page before wiring anything up:
     *   await SN.ifsStore.probe()
     * Reads are already proven; this exists to answer whether an authenticated
     * same-origin WRITE is accepted, and whether a CSRF token is demanded.
     */
    async probe() {
      const report = {
        projection: SVC,
        cookiesSeen: document.cookie
          .split(';')
          .map((c) => c.split('=')[0].trim())
          .filter((n) => /csrf|xsrf|token/i.test(n)),
        csrfHeadersSent: Object.keys(csrf())
      };

      try {
        await call('GET', `${SVC}/${SET}?$top=1`);
        report.read = 'ok';
      } catch (err) {
        report.read = `${err.status || '?'} — ${err.message}`;
        if (err.status === 404) {
          // Overwhelmingly the customer-side cause, so lead with it: the popup
          // shows this text verbatim to whoever just enabled the site.
          report.hint =
            'The CStickyNotes custom entity was not found in this environment. ' +
            'Import the Application Configuration Package supplied with the extension, ' +
            `then try again. (If it was imported, check that the projection is really ` +
            `named ${SVC} — correct SVC/SET at the top of ifsStore.js if not.)`;
          return report;
        }
      }

      const probeId = 'probe-' + crypto.randomUUID();
      let objkey = null;
      try {
        const row = await call('POST', `${SVC}/${SET}`, {
          [F.noteId]: probeId,
          [F.recordKey]: '__probe__',
          [F.noteText]: 'write probe — safe to delete'
        });
        objkey = row && row[F.key];
        report.write = 'ok';
        report.keyReturnedOnCreate = objkey ? 'yes' : 'no (createNote will re-query)';
      } catch (err) {
        report.write = `${err.status || '?'} — ${err.message}`;
        report.hint =
          err.status === 401 || err.status === 403
            ? 'Reading works but writing is refused. Your user most likely needs access to the ' +
              'CStickyNotes projection in the permission set. (If the grant is right, a CSRF token ' +
              'may be required — reproduce a write from Aurena in the Network tab and copy ' +
              'whichever request header differs.)'
            : 'Write rejected for a non-auth reason — compare the message against the LU definition.';
        return report;
      }

      try {
        if (!objkey) {
          const found = await call(
            'GET',
            `${SVC}/${SET}?$filter=${encodeURIComponent(F.noteId + ' eq ' + lit(probeId))}&$top=1`
          );
          objkey = found && found.value && found.value[0] && found.value[0][F.key];
        }
        if (objkey) {
          await call('DELETE', keyUrl(objkey), undefined, { 'If-Match': '*' });
          report.cleanup = 'ok';
        } else {
          report.cleanup = `could not locate the probe row (${F.noteId}='${probeId}') — delete it by hand`;
        }
      } catch (err) {
        report.cleanup = `left behind ${F.noteId}='${probeId}': ${err.message}`;
      }

      return report;
    }
  };

  SN.ifsStore = store;
})(window.SN);
