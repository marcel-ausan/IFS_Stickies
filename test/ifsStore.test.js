'use strict';
/*
 * Unit-tests ifsStore.js against a stub fetch, using the REAL response shape
 * captured from the live CStickyNotes entity (Objkey key, Cf_ prefixed
 * case-flattened fields, numbers serialised as strings).
 *
 * Covers everything that does not need a live IFS: URL construction, OData
 * quote escaping, field mapping both ways, numeric coercion, etag capture and
 * If-Match, the server-generated-key create path (both variants), and the
 * notify payload.
 *
 *   node test/ifsStore.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const calls = [];
let nextResponse = () => ({ status: 200, body: { value: [] } });

const sandbox = {
  console,
  crypto: { randomUUID: () => 'uuid-fixed' },
  document: { cookie: 'XSRF-TOKEN=tok123; other=x' },
  location: { href: 'https://host/main/ifsapplications/web/page/X/Form' },
  window: {},
  async fetch(url, opts) {
    calls.push({ url, opts });
    const r = nextResponse(url, opts);
    return {
      ok: r.status < 400,
      status: r.status,
      statusText: 'x',
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body))
    };
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'content', 'ifsStore.js'), 'utf8'),
  sandbox
);

const store = sandbox.window.SN.ifsStore;
let failed = 0;
const check = (label, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) failed++;
};
const lastBody = () => JSON.parse(calls.at(-1).opts.body);
const lastUrl = () => decodeURIComponent(calls.at(-1).url);

// Verbatim from the live response.
const LIVE_ROW = {
  '@odata.etag': 'W/"Vy8iNUE5QUIyNTUi"',
  Objkey: '5A9AB255098180E6E06325A2F20A9EC1',
  Cf_Noteid: 'uuid-1',
  Cf_Recordkey: "WorkOrder/Form::(WoNo='1')",
  Cf_Luname: 'ActiveWorkOrder',
  Cf_Keyref: "(WoNo='1')",
  Cf_Pageurl: 'https://host/page;record=abc',
  Cf_Notetext: 'hello @ARC-A',
  Cf_Color: '#fff7a8',
  Cf_Posx: '10',
  Cf_Posy: '20',
  Cf_Width: '440',
  Cf_Height: '360',
  Cf_Createdby: 'ARC-JSMITH',
  Cf_Createddate: '2026-09-03T23:28:00Z',
  Cf_Updatedby: 'ARC-JSMITH',
  Cf_Updateddate: '2026-09-03T23:40:00Z',
  Cf_Mentions: 'ARC-A, ARC-B',
  Cf_Notifiedto: 'ARC-A'
};

(async () => {
  // --- list ---
  nextResponse = () => ({ status: 200, body: { value: [LIVE_ROW] } });
  const notes = await store.listNotes("WorkOrder/Form::(WoNo='1')");
  const url = lastUrl();

  check('hits the custom projection', url.includes('CustomProjectionCStickyNotes.svc/CStickyNotesSet'));
  check('filters on the Cf_ column', url.includes("Cf_Recordkey eq 'WorkOrder/Form::(WoNo=''1'')'"), url);
  check("escapes ' by doubling", url.includes("(WoNo=''1'')"));
  check('id is Objkey, not Cf_Noteid', notes[0].id === '5A9AB255098180E6E06325A2F20A9EC1');
  check('Cf_Noteid still exposed', notes[0].noteId === 'uuid-1');
  check('maps Cf_ fields', notes[0].noteText === 'hello @ARC-A' && notes[0].luName === 'ActiveWorkOrder');
  check('coerces string numbers', notes[0].posX === 10 && notes[0].width === 440, typeof notes[0].posX);
  check('splits mentions', notes[0].mentions.length === 2 && notes[0].mentions[1].userId === 'ARC-B');
  check('reads who was already notified', notes[0].notifiedUserIds.join(',') === 'ARC-A');
  check('createdAt mapped', notes[0].createdAt === '2026-09-03T23:28:00Z');
  check('updatedAt mapped from Cf_Updateddate', notes[0].updatedAt === '2026-09-03T23:40:00Z');
  check('CSRF header echoed from cookie', calls.at(-1).opts.headers['X-XSRF-TOKEN'] === 'tok123');
  check('credentials included', calls.at(-1).opts.credentials === 'include');

  // --- create: server owns the key ---
  nextResponse = () => ({ status: 200, body: { ...LIVE_ROW, Objkey: 'NEWKEY1', Cf_Noteid: 'uuid-fixed' } });
  const created = await store.createNote({
    recordKey: 'rk', luName: 'LU', noteText: 'x', userId: 'ARC-M', posX: 1, posY: 2,
    mentions: [{ userId: 'ARC-A' }, { userId: 'ARC-B' }]
  });
  const cb = lastBody();
  check('create POSTs', calls.at(-1).opts.method === 'POST');
  check('create does NOT send Objkey (server generates it)', !('Objkey' in cb), Object.keys(cb).join(','));
  check('create stamps Cf_Noteid', cb.Cf_Noteid === 'uuid-fixed');
  check('create maps to Cf_ names', cb.Cf_Recordkey === 'rk' && cb.Cf_Createdby === 'ARC-M');
  check('create joins mentions to a comma list', cb.Cf_Mentions === 'ARC-A,ARC-B');
  check('create stamps a created date', typeof cb.Cf_Createddate === 'string');
  check('create stamps an updated date too', cb.Cf_Updateddate === cb.Cf_Createddate);
  check('create omits absent fields', !('Cf_Keyref' in cb));
  check('create returns the server key as id', created.id === 'NEWKEY1');

  // --- create when the POST answers 204: recover by Cf_Noteid ---
  let phase = 0;
  nextResponse = () => (phase++ === 0
    ? { status: 204, body: undefined }
    : { status: 200, body: { value: [{ ...LIVE_ROW, Objkey: 'RECOVERED', Cf_Noteid: 'uuid-fixed' }] } });
  const recovered = await store.createNote({ recordKey: 'rk' });
  check('204 create re-queries by Cf_Noteid', lastUrl().includes("Cf_Noteid eq 'uuid-fixed'"));
  // Naming a field the LU does not have (Cf_Updateddate today) 400s the query.
  check('no $select anywhere (a missing field would 400)',
    !calls.some((c) => c.url.indexOf('$select') !== -1));
  check('204 create still returns an id', recovered.id === 'RECOVERED');

  // --- update ---
  nextResponse = () => ({ status: 204, body: undefined });
  const updated = await store.updateNote('5A9AB255098180E6E06325A2F20A9EC1', { noteText: 'edited' });
  check('update PATCHes', calls.at(-1).opts.method === 'PATCH');
  check('update keys on Objkey', lastUrl().includes("CStickyNotesSet(Objkey='5A9AB255098180E6E06325A2F20A9EC1')"), lastUrl());
  check('update sends the cached etag', calls.at(-1).opts.headers['If-Match'] === 'W/"Vy8iNUE5QUIyNTUi"');
  check('update survives a 204', updated.id === '5A9AB255098180E6E06325A2F20A9EC1' && updated.noteText === 'edited');
  // No Rowversion on a Custom LU, so if we don't stamp it nothing does.
  check('update stamps Cf_Updateddate', typeof lastBody().Cf_Updateddate === 'string', JSON.stringify(lastBody()));
  check('update echoes updatedAt back on 204', typeof updated.updatedAt === 'string');

  await store.updateNote('unknown-key', { color: '#fff' });
  check("unknown row falls back to If-Match '*'", calls.at(-1).opts.headers['If-Match'] === '*');

  // --- delete ---
  await store.deleteNote('5A9AB255098180E6E06325A2F20A9EC1');
  check('delete DELETEs the keyed URL', calls.at(-1).opts.method === 'DELETE' && lastUrl().includes("Objkey='5A9AB255"));

  /* --- stale etag (412 "Resource already modified") ------------------------
   * A PATCH answers 204 with no body, so nothing refreshed the cached etag and
   * every write after the first failed — silently, because queueSave only warns.
   * Two defences: ask for the row back (Prefer), and retry once after a re-read.
   */
  nextResponse = () => ({
    status: 200,
    body: { value: [{ ...LIVE_ROW, Objkey: 'ETAGKEY', '@odata.etag': 'W/"old"' }] }
  });
  await store.listNotes('rk');

  let step = 0;
  nextResponse = () => {
    step += 1;
    if (step === 1) return { status: 412, body: { error: { message: 'Resource already modified.' } } };
    if (step === 2) return { status: 200, body: { ...LIVE_ROW, Objkey: 'ETAGKEY', '@odata.etag': 'W/"new"' } };
    return { status: 204, body: undefined };
  };
  const mark = calls.length;
  await store.updateNote('ETAGKEY', { noteText: 'x' });
  const seq = calls.slice(mark);

  check('PATCH asks for the row back', seq[0].opts.headers.Prefer === 'return=representation');
  check('412 re-reads then retries',
    seq.length === 3 && seq[0].opts.method === 'PATCH' && seq[1].opts.method === 'GET' && seq[2].opts.method === 'PATCH',
    seq.map((c) => c.opts.method).join(','));
  check('retry uses the refreshed etag', seq[2].opts.headers['If-Match'] === 'W/"new"', seq[2].opts.headers['If-Match']);

  // With Prefer honoured there should be no second 412 at all.
  nextResponse = () => ({ status: 200, body: { ...LIVE_ROW, Objkey: 'ETAGKEY', '@odata.etag': 'W/"v2"' } });
  await store.updateNote('ETAGKEY', { noteText: 'y' });
  await store.updateNote('ETAGKEY', { noteText: 'z' });
  check('a returned row refreshes the etag for the next write',
    calls.at(-1).opts.headers['If-Match'] === 'W/"v2"', calls.at(-1).opts.headers['If-Match']);

  // If the re-read also fails, go unconditional rather than lose the note.
  let s2 = 0;
  nextResponse = () => {
    s2 += 1;
    if (s2 === 1) return { status: 412, body: {} };
    if (s2 === 2) return { status: 500, body: {} };
    return { status: 204, body: undefined };
  };
  await store.updateNote('ETAGKEY', { noteText: 'w' });
  check("a failed re-read falls back to If-Match '*'", calls.at(-1).opts.headers['If-Match'] === '*');

  // --- notify: extension composes, IFS config sends ---
  const note = {
    id: 'NEWKEY1', luName: 'ActiveWorkOrder', keyRef: "(WoNo='1')",
    noteText: 'please look @ARC-A', updatedBy: 'ARC-JSMITH',
    pageUrl: 'https://host/main/ifsapplications/web/page/WorkOrder/Form;record=abc'
  };
  note.notifiedUserIds = ['ARC-A']; // mailed on an earlier send
  const res = await store.notifyMentions('NEWKEY1', ['ARC-B'], note);
  let nb = lastBody();

  check('Cf_Notifyto is THIS send only', nb.Cf_Notifyto === 'ARC-B', nb.Cf_Notifyto);
  check('Cf_Notifiedto accumulates', nb.Cf_Notifiedto === 'ARC-A,ARC-B', nb.Cf_Notifiedto);
  check('already-notified are not re-mailed', !nb.Cf_Notifyto.includes('ARC-A'));
  check('returns the cumulative list', res.notifiedUserIds.join(',') === 'ARC-A,ARC-B');

  // Fresh note, nobody notified yet — the rest of the assertions read this send.
  delete note.notifiedUserIds;
  await store.notifyMentions('NEWKEY1', ['ARC-A', 'ARC-B'], note);
  nb = lastBody();
  check('notify PATCHes the row (no action, no PL/SQL)', calls.at(-1).opts.method === 'PATCH');
  check('notify comma-joins recipients', nb.Cf_Notifyto === 'ARC-A,ARC-B');
  check('subject names the record', nb.Cf_Notifysubject === "You were mentioned on ActiveWorkOrder (WoNo='1')", nb.Cf_Notifysubject);
  check('body carries the deep link', nb.Cf_Notifybody.includes('record=abc'));
  check('body carries the note text', nb.Cf_Notifybody.includes('please look @ARC-A'));
  check('body names the mentioner', nb.Cf_Notifybody.includes('ARC-JSMITH mentioned you'));

  /* The E-Mail action renders the body as HTML: a plain-text body arrived as one
   * run-on paragraph with the separators showing as literal dashes. */
  check('body is HTML', nb.Cf_Notifybody.includes('<p>') && nb.Cf_Notifybody.includes('</div>'));
  check('deep link is an anchor', nb.Cf_Notifybody.includes('<a href="https://host'));

  const multi = store.buildMessage(
    { luName: 'LU', noteText: 'line one\nline two', updatedBy: 'ARC-M' },
    ['ARC-A']
  );
  check('newlines in the note become <br>', multi.body.includes('line one<br>line two'), multi.body);

  // Note text is user input on its way to someone else's mail client.
  const nasty = store.buildMessage(
    { luName: 'LU', noteText: '<script>alert(1)</script> a & b', updatedBy: 'ARC-M' },
    ['ARC-A']
  );
  check('note text is HTML-escaped',
    nasty.body.includes('&lt;script&gt;') && nasty.body.includes('a &amp; b') &&
      !nasty.body.includes('<script>'),
    nasty.body.slice(0, 120));
  check('trigger present for the event condition', typeof nb.Cf_Notifytrigger === 'string');

  // The Custom Event fires on Cf_Notifytrigger CHANGING, so it must differ.
  await new Promise((r) => setTimeout(r, 5));
  await store.notifyMentions('NEWKEY1', ['ARC-C'], note);
  check('trigger changes between batches', lastBody().Cf_Notifytrigger !== nb.Cf_Notifytrigger);

  // An ordinary edit must not touch the notify fields, or every save re-mails.
  await store.updateNote('NEWKEY1', { noteText: 'just typing' });
  const eb = lastBody();
  check('ordinary edit writes no notify fields',
    !Object.keys(eb).some((k) => k.startsWith('Cf_Notify')), Object.keys(eb).join(','));

  const before = calls.length;
  await store.notifyMentions('NEWKEY1', [], note);
  check('notify with no recipients makes no call', calls.length === before);

  const bare = store.buildMessage({}, ['ARC-A']);
  check('buildMessage tolerates an empty note', bare.subject.length > 0 && bare.body.includes('(empty)'));

  // --- errors ---
  nextResponse = () => ({ status: 403, body: { error: { message: 'no grant' } } });
  let caught = null;
  try { await store.listNotes('rk'); } catch (e) { caught = e; }
  check('errors surface status + message', caught && caught.status === 403 && caught.message === 'no grant');

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
