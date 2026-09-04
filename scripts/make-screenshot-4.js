/*
 * Builds store-assets/screenshot-4.png - a note on a Customer Order, with the
 * Notify button armed - at 1280x800.
 *
 *   node scripts/make-screenshot-4.js --serve      # serves the tile on :8792
 *   chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=1 \
 *     --window-size=1280,800 --virtual-time-budget=3000 \
 *     --screenshot=store-assets\screenshot-4.png http://localhost:8792/
 *
 * Unlike shot 3, this one IS a live capture - the point is the note sitting on a
 * real IFS page, which cannot be faked convincingly. store-assets/source-capture-4.png
 * is that capture, with the customer and order data already blurred in it.
 *
 * What this script still has to remove is the user id, which carries the
 * environment prefix. It is patched, not blurred: the note background is flat, so
 * a rectangle in the sampled note colour is invisible, and the affected lines are
 * redrawn over it. The type sizes come from content.js (13px note text, 10px
 * footer) multiplied by the capture's 1.807 scale - the note is NOTE_W = 440 CSS
 * px and 795 px wide in the capture - so the redrawn text matches its neighbours
 * instead of approximating them.
 */
const fs = require('fs');
const path = require('path');

const S = 1.807;                    // capture pixels per CSS pixel
const CROP_Y = 10;                  // skip the window's dark top edge
const TILE_W = 1280, SHOT_H = 670, STRIPE = 7, BAND_H = 123;
const SRC_W = 1988;
const SCALE = TILE_W / SRC_W;

const NOTE_R = 1672;                // right edge of the footer text, source px
const TEXT_L = 891;                 // left edge of the note's text, source px
const USER = 'JSMITH';              // replaces the real id everywhere it shows

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html, body { margin:0; padding:0; }
#tile, #tile * { box-sizing: border-box; }
#tile { width:${TILE_W}px; height:800px; position:relative; overflow:hidden; background:#fff;
        font-family:'Segoe UI',Arial,sans-serif; }
#shot { position:absolute; left:0; top:0; width:${TILE_W}px; height:${SHOT_H}px; overflow:hidden; }
#inner { position:absolute; left:0; top:0; width:${SRC_W}px;
         transform: scale(${SCALE}) translateY(-${CROP_Y}px); transform-origin:0 0; }
#inner img { display:block; width:${SRC_W}px; }
/* patches, in source pixels */
.patch { position:absolute; }
#pMention { left:885px; top:246px; width:800px; height:34px; }
#pMention span { position:absolute; left:6px; top:2px; font-size:${(13 * S).toFixed(1)}px;
   line-height:${(13 * 1.35 * S).toFixed(1)}px; color:#222; white-space:nowrap; }
#pFoot { left:1290px; top:592px; width:${NOTE_R - 1290}px; height:48px; }
#pFoot span { position:absolute; right:13px; font-size:${(10 * S).toFixed(1)}px;
   line-height:${(10 * 1.33 * S).toFixed(1)}px; color:#222; opacity:.55; white-space:nowrap; }
#pFoot .l1 { top:0; } #pFoot .l2 { top:${(10 * 1.33 * S).toFixed(1)}px; }
#stripe { position:absolute; left:0; right:0; bottom:${BAND_H}px; height:${STRIPE}px; display:flex; }
#stripe i { flex:1; display:block; }
#band { position:absolute; left:0; right:0; bottom:0; height:${BAND_H}px; background:#16181d; padding:26px 56px; }
#band h4 { font-family:Georgia,serif; font-weight:400; font-size:32px; color:#fff; margin:0 0 12px; }
#band p { font-size:19px; color:#a9abb2; margin:0; }
</style></head><body>
<div id="tile">
  <div id="shot"><div id="inner">
    <img id="src" src="source-capture-4.png">
    <div class="patch" id="pMention"><span>Call the customer and agree the billing dates @${USER}</span></div>
    <div class="patch" id="pFoot">
      <span class="l1">Created ${USER} &middot; 2026-09-04 20:41</span>
      <span class="l2">Updated ${USER} &middot; 2026-09-04 20:41</span>
    </div>
  </div></div>
  <div id="stripe"></div>
  <div id="band">
    <h4>Nothing is sent until you press Notify.</h4>
    <p>The note saves as you type. The e-mail goes when you decide it should &mdash; and only to people not already told.</p>
  </div>
</div>
<script>
document.getElementById('stripe').innerHTML =
  ['#fff7a8','#ffd8a8','#ffd1dc','#e6d5ff','#bfe3ff','#c3f2ef','#c8f7c5','#e4e6ea']
    .map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('');

// Take the patch colour from the note itself rather than trusting a hex - the
// capture has been through PNG and whatever the display profile did to it.
var img = document.getElementById('src');
function paint() {
  var c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  var d = c.getContext('2d').getImageData(1550, 350, 1, 1).data;   // flat note interior
  var col = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
  document.getElementById('pMention').style.background = col;
  document.getElementById('pFoot').style.background = col;
  document.title = 'sampled ' + col;
}
if (img.complete) paint(); else img.onload = paint;
</script></body></html>`;

const dir = path.join(__dirname, '..', 'store-assets');
fs.writeFileSync(path.join(dir, '_tile4.html'), html);
console.log('wrote store-assets/_tile4.html');

if (process.argv.indexOf('--serve') !== -1) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png' };
  require('http').createServer((q, r) => {
    const name = q.url === '/' ? '_tile4.html' : decodeURIComponent(q.url.slice(1));
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    r.end(fs.readFileSync(f));
  }).listen(8792, () => console.log('serving store-assets/ on http://localhost:8792/'));
}
