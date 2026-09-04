# Regenerates the extension's toolbar icons with the same motif as the store icon,
# so the thing you see in the toolbar matches the thing you saw in the store.
#
# The "@" is dropped below 32px - at 16 it collapses into a smudge and the note
# shape alone reads better.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$OUT = 'C:\WORK\IFS_DEV_Work\00_GIT_Repo\Claude\ifs-sticky-notes\extension\icons'
function C([string]$hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

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

function MakeIcon([int]$S, [string]$path) {
  $bm = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bm)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)

  $k = $S / 128.0
  $m = [math]::Max(1, [int](6 * $k))                       # tile margin
  $tile = New-Object System.Drawing.Rectangle($m, $m, ($S - 2 * $m), ($S - 2 * $m))
  $b = New-Object System.Drawing.SolidBrush((C '#16181d'))
  RoundRect $g $tile ([math]::Max(2, [int](26 * $k))) $b
  $b.Dispose()

  # note with a folded bottom-right corner
  $l = 30 * $k; $r = 98 * $k; $t = 30 * $k; $bt = 98 * $k; $f = 74 * $k
  $np = New-Object System.Drawing.Drawing2D.GraphicsPath
  $np.AddLine($l, $t, $r, $t)
  $np.AddLine($r, $t, $r, $f)
  $np.AddLine($r, $f, $f, $bt)
  $np.AddLine($f, $bt, $l, $bt)
  $np.CloseFigure()
  $b = New-Object System.Drawing.SolidBrush((C '#fff7a8'))
  $g.FillPath($b, $np); $b.Dispose(); $np.Dispose()

  $fp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $fp.AddLine($r, $f, $f, $f)
  $fp.AddLine($f, $f, $f, $bt)
  $fp.CloseFigure()
  $b = New-Object System.Drawing.SolidBrush((C '#d8c96a'))
  $g.FillPath($b, $fp); $b.Dispose(); $fp.Dispose()

  if ($S -ge 32) {
    $fnt = New-Object System.Drawing.Font('Segoe UI', (46 * $k), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $b = New-Object System.Drawing.SolidBrush((C '#16181d'))
    $g.DrawString('@', $fnt, $b, (44 * $k), (36 * $k))
    $fnt.Dispose(); $b.Dispose()
  }

  $g.Dispose()
  $bm.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bm.Dispose()
  '  wrote ' + (Split-Path $path -Leaf)
}

MakeIcon 16  "$OUT\icon16.png"
MakeIcon 48  "$OUT\icon48.png"
MakeIcon 128 "$OUT\icon128.png"
