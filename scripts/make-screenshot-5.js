/*
 * Builds store-assets/screenshot-5.png - the notification as it arrives - 1280x800.
 *
 *   node scripts/make-screenshot-5.js --serve
 *   chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=1 \
 *     --window-size=1280,800 --virtual-time-budget=4000 \
 *     --screenshot=store-assets\screenshot-5.png http://localhost:8793/
 *
 * A real delivered message in Outlook (dark mode), which is the point - it is the
 * only evidence in the set that the mail actually sends, and the shipped event
 * action is the part most likely to be doubted.
 *
 * Same patch-don't-blur treatment as shot 4: the two lines carrying the user id
 * sit on flat backgrounds - the message ground and the quote block's olive - so a
 * rectangle in the sampled colour is invisible and the lines are redrawn over it.
 */
const fs = require('fs');
const path = require('path');

const TILE_W = 1280, SHOT_H = 670, BAND_H = 123, STRIPE = 7;
const SRC_W = 1292, SRC_H = 864;

// the message, without the window's dead margins
const CROP_X = 0, CROP_Y = 16, CROP_W = 935, CROP_H = 790;
const CARD_H = 596;                       // on the tile
const K = CARD_H / CROP_H;                // 0.754
const CARD_W = Math.round(CROP_W * K);

const USER = 'JSMITH';
const FS = 29;                            // message body, source px
const INK = '#e8e8e8';

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html, body { margin:0; padding:0; }
#tile, #tile * { box-sizing: border-box; }
#tile { width:${TILE_W}px; height:800px; position:relative; overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif; background:#fff; }
#stage { position:absolute; left:0; top:0; right:0; height:${SHOT_H}px;
   background: radial-gradient(900px 560px at 30% 20%, #fffdf4 0%, #fbf6e6 48%, #f2ebd6 100%); }
#card { position:absolute; left:62px; top:${Math.round((SHOT_H - CARD_H) / 2)}px;
   width:${CARD_W}px; height:${CARD_H}px; overflow:hidden; border-radius:10px;
   box-shadow:0 24px 56px rgba(40,32,0,.26), 0 3px 10px rgba(40,32,0,.12); }
#inner { position:absolute; left:0; top:0; width:${SRC_W}px; height:${SRC_H}px;
   transform: scale(${K}) translate(-${CROP_X}px, -${CROP_Y}px); transform-origin:0 0; }
#inner img { display:block; width:${SRC_W}px; }
.patch { position:absolute; }
#pBody { left:14px; top:243px; width:906px; height:40px; }
#pBody span { position:absolute; left:8px; top:4px; font-size:${FS}px; line-height:32px;
   color:${INK}; white-space:nowrap; }
#pBody b { color:#fff; font-weight:600; }
#pQuote { left:56px; top:744px; width:874px; height:46px; }
#pQuote span { position:absolute; left:1px; top:5px; font-size:${FS}px; line-height:34px;
   color:${INK}; white-space:nowrap; }
#copy { position:absolute; left:${62 + CARD_W + 54}px; top:112px; right:44px; }
#copy h3 { font-family:Georgia,serif; font-weight:400; font-size:33px; line-height:1.24;
   color:#1d1b14; margin:0 0 22px; }
#copy li { list-style:none; font-size:16.5px; line-height:1.5; color:#4a4740;
   margin:0 0 15px; padding-left:27px; position:relative; }
#copy ul { margin:0; padding:0; }
#copy li b { color:#1d1b14; font-weight:600; }
#copy li::before { content:''; position:absolute; left:0; top:6px; width:12px; height:12px;
   border-radius:3px; background:#f5b301; }
#stripe { position:absolute; left:0; right:0; bottom:${BAND_H}px; height:${STRIPE}px; display:flex; }
#stripe i { flex:1; display:block; }
#band { position:absolute; left:0; right:0; bottom:0; height:${BAND_H}px; background:#16181d; padding:26px 56px; }
#band h4 { font-family:Georgia,serif; font-weight:400; font-size:32px; color:#fff; margin:0 0 12px; }
#band p { font-size:19px; color:#a9abb2; margin:0; }
</style></head><body>
<div id="tile">
  <div id="stage"></div>
  <div id="card"><div id="inner">
    <img id="src" src="source-capture-5.png">
    <div class="patch" id="pBody"><span>${USER} mentioned you in a note on <b>CustomerOrder C5934</b>.</span></div>
    <div class="patch" id="pQuote"><span>Call the customer and agree the billing dates @${USER}</span></div>
  </div></div>
  <div id="copy">
    <h3>And this is what lands in their inbox.</h3>
    <ul>
      <li>The subject names the record &mdash; <b>CustomerOrder C5934</b>, not a key reference.</li>
      <li><b>One link</b>, straight back to the record it was written on.</li>
      <li>The note itself, quoted, so it reads without opening anything.</li>
    </ul>
  </div>
  <div id="stripe"></div>
  <div id="band">
    <h4>Sent by IFS, not by the extension.</h4>
    <p>A Custom Event in your own environment sends it. The extension only writes the row that sets it off.</p>
  </div>
</div>
<script>
document.getElementById('stripe').innerHTML =
  ['#fff7a8','#ffd8a8','#ffd1dc','#e6d5ff','#bfe3ff','#c3f2ef','#c8f7c5','#e4e6ea']
    .map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('');

// Sample both grounds off the image: the message background and the quote block's
// olive. Guessing hexes through a PNG and a display profile leaves a visible seam.
var img = document.getElementById('src');
function paint() {
  var c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  var g = c.getContext('2d'); g.drawImage(img, 0, 0);
  function at(x, y) { var d = g.getImageData(x, y, 1, 1).data; return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')'; }
  var bg = at(600, 305), quote = at(700, 722);
  document.getElementById('pBody').style.background = bg;
  document.getElementById('pQuote').style.background = quote;
  document.title = 'bg ' + bg + ' / quote ' + quote;
}
if (img.complete) paint(); else img.onload = paint;
</script></body></html>`;

const dir = path.join(__dirname, '..', 'store-assets');
fs.writeFileSync(path.join(dir, '_tile5.html'), html);
console.log('wrote store-assets/_tile5.html  card', CARD_W + 'x' + CARD_H, 'k=' + K.toFixed(3));

if (process.argv.indexOf('--serve') !== -1) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png' };
  require('http').createServer((q, r) => {
    const name = q.url === '/' ? '_tile5.html' : decodeURIComponent(q.url.slice(1));
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    r.end(fs.readFileSync(f));
  }).listen(8793, () => console.log('serving store-assets/ on http://localhost:8793/'));
}
