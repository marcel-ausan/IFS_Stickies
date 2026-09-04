# Generates the Chrome Web Store graphic assets with System.Drawing.
#   store-icon-128.png   32-bit, rounded tile
#   screenshot-1.png     1280x800, 24-bit (no alpha, as the store requires)
#
# The screenshot is a faithful product illustration, not a doctored capture of a
# real IFS page: the note is drawn exactly as the extension renders it, but the
# page behind it is a neutral abstraction with no IFS branding or real data.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$OUT = 'C:\WORK\IFS_DEV_Work\00_GIT_Repo\Claude\ifs-sticky-notes\store-assets'
if (-not (Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT | Out-Null }

# --- palette (matches the extension) ---------------------------------------
function C([string]$hex) {
  [System.Drawing.ColorTranslator]::FromHtml($hex)
}
$INK     = C '#16181d'
$PAPER   = C '#f7f6f3'
$WHITE   = C '#ffffff'
$HAIR    = C '#e4e2dc'
$TEXT    = C '#1b1d22'
$TEXT2   = C '#55585f'
$TEXT3   = C '#9a9ca2'
$AMBER   = C '#f5b301'
$AMBERINK= C '#3a2a00'
$NOTE    = C '#fff7a8'
$NOTEBAR = C '#efe79c'
$NOTES   = @('#fff7a8','#ffd8a8','#ffd1dc','#e6d5ff','#bfe3ff','#c3f2ef','#c8f7c5','#e4e6ea')

function RoundRect($g, $rect, $r, $brush) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $p.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $p.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $p.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  $g.FillPath($brush, $p)
  $p.Dispose()
}

function Text($g, [string]$s, [string]$family, [single]$size, [int]$style, $color, [single]$x, [single]$y) {
  $f = New-Object System.Drawing.Font($family, $size, [System.Drawing.FontStyle]$style, [System.Drawing.GraphicsUnit]::Pixel)
  $b = New-Object System.Drawing.SolidBrush($color)
  $g.DrawString($s, $f, $b, $x, $y)
  $f.Dispose(); $b.Dispose()
}

function TextRight($g, [string]$s, [string]$family, [single]$size, [int]$style, $color, [single]$right, [single]$y) {
  $f = New-Object System.Drawing.Font($family, $size, [System.Drawing.FontStyle]$style, [System.Drawing.GraphicsUnit]::Pixel)
  $b = New-Object System.Drawing.SolidBrush($color)
  $w = $g.MeasureString($s, $f).Width
  $g.DrawString($s, $f, $b, $right - $w, $y)
  $f.Dispose(); $b.Dispose()
}

# ===========================================================================
# 1. Store icon 128x128
# ===========================================================================
$icon = New-Object System.Drawing.Bitmap(128, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($icon)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)

# Dark tile, small margin so it reads as an app icon rather than a full bleed.
$tile = New-Object System.Drawing.Rectangle(6, 6, 116, 116)
$b = New-Object System.Drawing.SolidBrush($INK)
RoundRect $g $tile 26 $b
$b.Dispose()

# The note: a yellow square with the bottom-right corner folded away.
$np = New-Object System.Drawing.Drawing2D.GraphicsPath
$np.AddLine(30, 30, 98, 30)
$np.AddLine(98, 30, 98, 74)
$np.AddLine(98, 74, 74, 98)
$np.AddLine(74, 98, 30, 98)
$np.CloseFigure()
$b = New-Object System.Drawing.SolidBrush($NOTE)
$g.FillPath($b, $np); $b.Dispose(); $np.Dispose()

# The fold itself, darker so the corner reads at 16px.
$fp = New-Object System.Drawing.Drawing2D.GraphicsPath
$fp.AddLine(98, 74, 74, 74)
$fp.AddLine(74, 74, 74, 98)
$fp.CloseFigure()
$b = New-Object System.Drawing.SolidBrush((C '#d8c96a'))
$g.FillPath($b, $fp); $b.Dispose(); $fp.Dispose()

# "@" - says mentions, and stays legible when scaled down.
Text $g '@' 'Segoe UI' 46 1 $INK 44 36

$g.Dispose()
$icon.Save("$OUT\store-icon-128.png", [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Dispose()
'wrote store-icon-128.png'

# ===========================================================================
# 2. Screenshot 1280x800 (24-bit, no alpha)
# ===========================================================================
$W = 1280; $H = 800
$img = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($img)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'ClearTypeGridFit'

$b = New-Object System.Drawing.SolidBrush($PAPER); $g.FillRectangle($b, 0, 0, $W, $H); $b.Dispose()

# --- header band ---
$b = New-Object System.Drawing.SolidBrush($INK); $g.FillRectangle($b, 0, 0, $W, 104); $b.Dispose()
Text $g 'IFS Sticky Notes' 'Georgia' 34 0 $WHITE 64 28
TextRight $g 'Free and open source' 'Segoe UI' 17 0 (C '#a9abb2') ($W - 64) 40

# the eight note colours, the product's own signature
$segW = $W / 8.0
for ($i = 0; $i -lt 8; $i++) {
  $b = New-Object System.Drawing.SolidBrush((C $NOTES[$i]))
  $g.FillRectangle($b, [single]($i * $segW), 104, [single]($segW + 1), 7)
  $b.Dispose()
}

# --- the "record page" behind the note: neutral, no IFS branding ---
$card = New-Object System.Drawing.Rectangle(64, 168, 760, 442)
$b = New-Object System.Drawing.SolidBrush($WHITE); RoundRect $g $card 10 $b; $b.Dispose()
$pen = New-Object System.Drawing.Pen($HAIR, 1); $g.DrawRectangle($pen, $card); $pen.Dispose()

Text $g 'Customer Order' 'Segoe UI' 15 0 $TEXT3 100 200
Text $g 'C130' 'Segoe UI' 30 1 $TEXT 100 222

# generic field rows - labels plus value bars, so nothing here is real data
$labels = @('Customer', 'Site', 'Order Type', 'Wanted Delivery',
            'Currency', 'Status', 'Coordinator', 'Delivery Terms')
$y = 292
for ($i = 0; $i -lt 8; $i++) {
  $col = if ($i % 2 -eq 0) { 100 } else { 420 }
  if ($i % 2 -eq 0 -and $i -gt 0) { $y += 78 }
  Text $g $labels[$i] 'Segoe UI' 13 0 $TEXT3 $col $y
  $b = New-Object System.Drawing.SolidBrush((C '#eceae5'))
  $g.FillRectangle($b, [single]$col, [single]($y + 24), 240, 14)
  $b.Dispose()
}

# --- the sticky note, drawn as the extension actually renders it ---
$nx = 716; $ny = 232; $nw = 484; $nh = 346

# soft drop shadow
for ($s = 10; $s -ge 1; $s--) {
  $a = [int](7 + $s)
  $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, 0, 0, 0))
  $r = New-Object System.Drawing.Rectangle(($nx - $s), ($ny - $s + 5), ($nw + 2 * $s), ($nh + 2 * $s))
  RoundRect $g $r 12 $b
  $b.Dispose()
}

$noteRect = New-Object System.Drawing.Rectangle($nx, $ny, $nw, $nh)
$b = New-Object System.Drawing.SolidBrush($NOTE); RoundRect $g $noteRect 6 $b; $b.Dispose()

# top bar with the colour dots and the close control, right-aligned as in the UI
$b = New-Object System.Drawing.SolidBrush($NOTEBAR); $g.FillRectangle($b, $nx, $ny, $nw, 30); $b.Dispose()
$dx = $nx + $nw - 40
for ($i = 7; $i -ge 0; $i--) {
  $b = New-Object System.Drawing.SolidBrush((C $NOTES[$i]))
  $g.FillEllipse($b, [single]$dx, [single]($ny + 10), 11, 11)
  $pen = New-Object System.Drawing.Pen((C '#b9ac5e'), 1)
  $g.DrawEllipse($pen, [single]$dx, [single]($ny + 10), 11, 11)
  $pen.Dispose(); $b.Dispose()
  $dx -= 16
}
# PS 5.1 has no "`u{}" escape - it renders literally. Use the char code.
Text $g ([string][char]0x00D7) 'Segoe UI' 17 0 (C '#7a2e2e') ($nx + $nw - 26) ($ny + 4)

# body text
Text $g 'Customer is holding shipment until the' 'Segoe UI' 18 0 (C '#222222') ($nx + 22) ($ny + 52)
Text $g 'revised PO lands. Do not release.'      'Segoe UI' 18 0 (C '#222222') ($nx + 22) ($ny + 78)
Text $g '@JSMITH'                                 'Segoe UI' 18 1 (C '#7a5a00') ($nx + 22) ($ny + 116)
Text $g ' can you confirm with them?'             'Segoe UI' 18 0 (C '#222222') ($nx + 108) ($ny + 116)

# footer: the notify button bottom-left, attribution bottom-right
$btn = New-Object System.Drawing.Rectangle(($nx + 18), ($ny + $nh - 60), 168, 42)
$b = New-Object System.Drawing.SolidBrush($AMBER); RoundRect $g $btn 8 $b; $b.Dispose()
Text $g ([string][char]0x2709) 'Segoe UI Symbol' 18 0 $AMBERINK ($nx + 34) ($ny + $nh - 49)
Text $g 'Notify 1' 'Segoe UI' 17 1 $AMBERINK ($nx + 64) ($ny + $nh - 48)

TextRight $g 'Created  JSMITH  2026-09-04 09:33' 'Segoe UI' 12 0 (C '#8a8468') ($nx + $nw - 18) ($ny + $nh - 44)
TextRight $g 'Updated  JSMITH  2026-09-04 09:41' 'Segoe UI' 12 0 (C '#8a8468') ($nx + $nw - 18) ($ny + $nh - 28)

# --- caption ---
Text $g 'Pinned to the record. Visible to your whole team.' 'Georgia' 32 0 $TEXT 64 652
Text $g 'Stored in your own IFS environment - no server, no third party, nothing to host.' 'Segoe UI' 19 0 $TEXT2 64 702

$g.Dispose()
$img.Save("$OUT\screenshot-1.png", [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
'wrote screenshot-1.png'
