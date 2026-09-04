# Run this on EVERY freshly exported ACP, before committing it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\stamp-acp-metadata.ps1
#
# IFS stamps the exporting environment into every package it produces:
#
#     <AUTHOR>dwre</AUTHOR>
#     <ORIGIN>DWRECFG1-dwre-cfg</ORIGIN>
#
# Both are shown to the administrator on the import wizard's Validation Summary,
# and this repository is public - so a customer's environment name would be on
# display to everyone who downloads the package, and to every other customer who
# imports it. This script rewrites them to the project's own identity and copies
# the result into extension/assets/, which is what the admin page serves.
#
# ---------------------------------------------------------------------------
# WHY THIS REBUILDS THE ARCHIVE INSTEAD OF EDITING IT IN PLACE
#
# The first version of this script opened the zip with ZipArchiveMode::Update and
# rewrote the manifest entry. The XML came out correct - byte-identical items,
# only the two field values changed, no BOM, same line endings - and the package
# still failed to import:
#
#     ORA-20124: Field [IMPORT_ID] is mandatory for Application Configuration
#     Item Import and requires a value.
#
# which is what you get when the import never sees the manifest at all. Rebuilding
# the same content with ZipArchiveMode::Create imports fine. Something about the
# in-place rewrite is not readable by the server-side unzip; the exact reason was
# never pinned down, so do not "simplify" this back to Update mode.
#
# Never use Compress-Archive here either: on Windows it writes backslash entry
# paths where IFS wrote forward slashes, and AppConfigPackageHandling.plsvc
# detects the manifest with INSTR(file_path,'Items/').
# ---------------------------------------------------------------------------
#
# Idempotent - safe to run twice.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ROOT   = Split-Path $PSScriptRoot -Parent
$DEPLOY = Join-Path $ROOT 'deploy'
$ASSETS = Join-Path $ROOT 'extension\assets'

$AUTHOR = 'marcel.ausan@gmail.com'
$ORIGIN = 'opensource-for-community'

# Anything matching this must not survive into a public package.
$SUSPECT = '(?i)dwre|DWRECFG'

$stamped = 0
$flagged = 0

Get-ChildItem -Path $DEPLOY -Filter *.zip -File | ForEach-Object {
  $path = $_.FullName
  Write-Host "=== $($_.Name) ==="

  # 1. read every entry into memory, preserving name, bytes and order
  $entries = @()
  $zin = [System.IO.Compression.ZipFile]::OpenRead($path)
  foreach ($e in $zin.Entries) {
    $ms = New-Object IO.MemoryStream
    $s = $e.Open(); $s.CopyTo($ms); $s.Close()
    $entries += [pscustomobject]@{ Name = $e.FullName; Bytes = $ms.ToArray() }
    $ms.Dispose()
  }
  $zin.Dispose()

  # 2. rewrite the two fields
  $touched = $false
  foreach ($en in $entries) {
    $text = [Text.Encoding]::UTF8.GetString($en.Bytes)
    $before = $text
    $text = [regex]::Replace($text, '<AUTHOR>[^<]*</AUTHOR>', "<AUTHOR>$AUTHOR</AUTHOR>")
    $text = [regex]::Replace($text, '<ORIGIN>[^<]*</ORIGIN>', "<ORIGIN>$ORIGIN</ORIGIN>")
    if ($text -ne $before) {
      $en.Bytes = [Text.Encoding]::UTF8.GetBytes($text)
      Write-Host "  stamped: $($en.Name)"
      $touched = $true
      $stamped++
    }
    foreach ($m in [regex]::Matches($text, $SUSPECT)) {
      Write-Host "  REVIEW: '$($m.Value)' still present in $($en.Name)" -ForegroundColor Yellow
      $flagged++
    }
  }

  # 3. rebuild from scratch - see the note at the top of this file
  if ($touched) {
    $tmp = "$path.new"
    if (Test-Path $tmp) { [IO.File]::Delete($tmp) }
    $fs = [IO.File]::Open($tmp, [IO.FileMode]::CreateNew)
    $zout = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    foreach ($en in $entries) {
      $entry = $zout.CreateEntry($en.Name, [System.IO.Compression.CompressionLevel]::Optimal)
      $o = $entry.Open(); $o.Write($en.Bytes, 0, $en.Bytes.Length); $o.Close()
    }
    $zout.Dispose(); $fs.Close()
    [IO.File]::Delete($path)
    [IO.File]::Move($tmp, $path)
    Write-Host "  rebuilt archive"
  } else {
    Write-Host "  already stamped"
  }

  [IO.File]::Copy($path, (Join-Path $ASSETS $_.Name), $true)
  Write-Host "  copied to extension/assets/"
}

Write-Host ""
Write-Host "$stamped file(s) stamped."
if ($flagged) {
  Write-Host "$flagged reference(s) need a manual look - see REVIEW lines above." -ForegroundColor Yellow
  exit 1
}
Write-Host "No environment references left."
Write-Host "TEST THE IMPORT before trusting these - a stamped package has broken one before."
