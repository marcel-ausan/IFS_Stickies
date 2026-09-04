# Screenshot 2: the @-mention picker mid-search, on a Purchase Order.
# The record is demo data prepared for this, so nothing is masked - unlike
# screenshot 1, which came from a live customer record.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$DIR = 'C:\WORK\IFS_DEV_Work\00_GIT_Repo\Claude\ifs-sticky-notes\store-assets'
$src = [System.Drawing.Bitmap]::FromFile("$DIR\source-capture-2.png")

function C([string]$hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }
function Txt($g, $s, $fam, $size, $style, $col, $x, $y) {
  $f = New-Object System.Drawing.Font($fam, $size, [System.Drawing.FontStyle]$style, [System.Drawing.GraphicsUnit]::Pixel)
  $b = New-Object System.Drawing.SolidBrush($col)
  $g.DrawString($s, $f, $b, [single]$x, [single]$y); $f.Dispose(); $b.Dispose()
}

$W = 1280; $H = 800; $SHOT_H = 670; $STRIPE = 7
$out = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = 'HighQualityBicubic'
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'ClearTypeGridFit'

# Crop: skip the IFS top bar (which carries the signed-in user's name and photo)
# and the left search panel, keeping the record and the note with its picker open.
# cy is tight: the green IFS bar (which carries the signed-in name and photo)
# ends around y=84, and the note starts at y=87. 86 clears one without clipping
# the other.
$cx = 330
$cy = 86
$cw = $src.Width - $cx
$ch = [int]($cw * $SHOT_H / $W)
$dest = New-Object System.Drawing.Rectangle(0, 0, $W, $SHOT_H)
$g.DrawImage($src, $dest, $cx, $cy, $cw, $ch, [System.Drawing.GraphicsUnit]::Pixel)

# A sliver of the green breadcrumb chip survives at the top left. Moving the crop
# down to lose it would clip the note colour dots, so paint it out with the page
# background sampled from just below it.
$bg = $out.GetPixel(60, 46)
$b = New-Object System.Drawing.SolidBrush($bg)
$g.FillRectangle($b, 0, 0, 118, 26)
$b.Dispose()

# the eight note colours as the divider, same signature as screenshot 1
$NOTES = @('#fff7a8','#ffd8a8','#ffd1dc','#e6d5ff','#bfe3ff','#c3f2ef','#c8f7c5','#e4e6ea')
$seg = $W / 8.0
for ($i = 0; $i -lt 8; $i++) {
  $b = New-Object System.Drawing.SolidBrush((C $NOTES[$i]))
  $g.FillRectangle($b, [single]($i * $seg), $SHOT_H, [single]($seg + 1), $STRIPE); $b.Dispose()
}

$b = New-Object System.Drawing.SolidBrush((C '#16181d'))
$g.FillRectangle($b, 0, ($SHOT_H + $STRIPE), $W, ($H - $SHOT_H - $STRIPE)); $b.Dispose()
Txt $g 'Type @ to tag a colleague.' 'Georgia' 32 0 ([System.Drawing.Color]::White) 56 700
Txt $g 'Searches names and user ids. They get an e-mail linking straight back to this record.' 'Segoe UI' 19 0 (C '#a9abb2') 56 748

$g.Dispose()
$out.Save("$DIR\screenshot-2.png", [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose(); $src.Dispose()
'wrote screenshot-2.png'
