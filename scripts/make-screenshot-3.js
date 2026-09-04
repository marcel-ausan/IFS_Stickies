/*
 * Builds store-assets/screenshot-3.png - the popup, at 1280x800.
 *
 *   node scripts/make-screenshot-3.js            # writes scratchpad/shot3.html
 *   node scripts/make-screenshot-3.js --serve    # ...and serves it on :8791
 *
 * then capture it at exactly the store's tile size:
 *
 *   chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=1 \
 *     --window-size=1280,800 --virtual-time-budget=3000 \
 *     --screenshot=store-assets\screenshot-3.png http://localhost:8791/
 *
 * Shots 1 and 2 are masked captures of a live environment. This one is not a
 * capture at all: it inlines the shipped popup.html, popup.css and popup.js and
 * runs them against a stubbed chrome.* that reports an enabled site, a detected
 * user and a passing probe. So the pixels are the real product - the customer's
 * host and user id are simply never in them, which beats blurring a live shot.
 *
 * Re-run this whenever the popup's markup or copy changes.
 */
const fs = require('fs');
const P = 'extension/src/popup/';
const raw = fs.readFileSync(P + 'popup.css', 'utf8');
// Scope every rule under #popup. The tile page must not inherit the popup's
// own body box (340px wide, 14px padding), and the popup must keep it exactly.
const css = raw.replace(/(^|})([^{}]+){/g, (m, close, sel) =>
  close + sel.split(',').map((one) => {
    const t = one.trim();
    if (!t || t.charAt(0) === '@') return one;
    return ' #popup ' + (t === 'body' || t === 'html' ? '' : t);
  }).join(',') + '{');
const js  = fs.readFileSync(P + 'popup.js', 'utf8');
const html = fs.readFileSync(P + 'popup.html', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src'));

// The real popup, driven by the real popup.js. Only chrome.* is faked - with the
// customer's host and user id replaced by neutral ones, which is the whole point
// of rebuilding the shot instead of blurring a live capture.
const stub = `
window.chrome = {
  tabs: {
    query: async () => [{ id: 1, url: 'https://acme.ifs.cloud/main/ifsapplications/web/page/PurchaseOrder/Form' }],
    sendMessage: async (id, m) =>
      m.type === 'sn-whoami' ? { detected: 'JSMITH' }
    : m.type === 'sn-probe'  ? { ok: true, report: { read: 'ok', write: 'ok' } }
    : null,
    create: () => {}
  },
  permissions: { contains: async () => true, request: async () => true, remove: async () => {} },
  storage: { sync: { get: async (d) => d, set: async () => {} } },
  runtime: { sendMessage: async () => {}, getURL: (p) => p }
};
`;

const tile = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${css}
html, body { margin:0; padding:0; }
#tile, #tile * { box-sizing: border-box; }
#tile { width:1280px; height:800px; position:relative; overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif; background:#fff; }
#stage { position:absolute; inset:0 0 130px 0; background:
   radial-gradient(1100px 620px at 62% 18%, #fffdf4 0%, #fbf6e6 46%, #f3ecd8 100%); }
/* faint oversized quote mark of the brand yellow, so the field is not dead space */
#stage::after { content:''; position:absolute; right:-120px; bottom:-180px; width:620px; height:620px;
   border-radius:50%; background:rgba(245,179,1,.10); }
#chrome { position:absolute; left:104px; top:34px; width:442px;
   border-radius:12px; background:#fff; box-shadow:0 26px 60px rgba(40,32,0,.22), 0 3px 10px rgba(40,32,0,.10);
   overflow:hidden; }
#chrome .bar { height:34px; background:#26282c; display:flex; align-items:center; padding:0 12px; gap:7px; }
#chrome .bar i { width:9px; height:9px; border-radius:50%; background:#4a4d53; display:block; }
#chrome .bar span { color:#9a9da4; font-size:11.5px; margin-left:8px; letter-spacing:.02em; }
#popup { zoom:1.30; background:#fff; }
#copy { position:absolute; left:620px; top:118px; width:566px; }
#copy h3 { font-family:Georgia,serif; font-size:37px; line-height:1.22; color:#1d1b14;
   margin:0 0 22px; font-weight:400; }
#copy ul { list-style:none; margin:0; padding:0; }
#copy li { font-size:17.5px; line-height:1.5; color:#4a4740; margin:0 0 16px; padding-left:30px; position:relative; }
#copy li b { color:#1d1b14; font-weight:600; }
#copy li::before { content:''; position:absolute; left:0; top:7px; width:13px; height:13px;
   border-radius:3px; background:#f5b301; }
#stripe { position:absolute; left:0; right:0; bottom:123px; height:7px; display:flex; }
#stripe i { flex:1; display:block; }
#band { position:absolute; left:0; right:0; bottom:0; height:123px; background:#16181d; padding:26px 56px; }
#band h4 { font-family:Georgia,serif; font-weight:400; font-size:32px; color:#fff; margin:0 0 12px; }
#band p { font-size:19px; color:#a9abb2; margin:0; }
</style></head><body>
<div id="tile">
  <div id="stage"></div>
  <div id="chrome">
    <div class="bar"><i></i><i></i><i></i><span>IFS Sticky Notes</span></div>
    <div id="popup">${body}</div>
  </div>
  <div id="copy">
    <h3>Set up once,<br>verified before you rely on it.</h3>
    <ul>
      <li>Grant access to <b>one IFS site</b>, from the popup. The extension asks for nothing at install.</li>
      <li><b>Check IFS setup</b> confirms the entity is there and that reads and writes both work.</li>
      <li>Your IFS user is <b>detected from the session</b> and signs every note.</li>
    </ul>
  </div>
  <div id="stripe"></div>
  <div id="band">
    <h4>No data leaves your IFS environment.</h4>
    <p>Notes are stored in your own tenant. No server behind the extension, no analytics, no telemetry.</p>
  </div>
</div>
<script>
${stub}
${js}
setTimeout(() => document.getElementById('test').click(), 60);
document.getElementById('stripe').innerHTML =
  ['#fff7a8','#ffd8a8','#ffd1dc','#e6d5ff','#bfe3ff','#c3f2ef','#c8f7c5','#e4e6ea']
    .map(c => '<i style="background:' + c + '"></i>').join('');
</script></body></html>`;

const out = 'C:/Users/marce/AppData/Local/Temp/claude/C--WORK-IFS-DEV-Work-00-GIT-Repo-IFS-Core-Code/c9d7aa15-a47e-4326-b570-320a71a08a08/scratchpad/shot3.html';
fs.writeFileSync(out, tile);
console.log('wrote', out, tile.length, 'bytes');
