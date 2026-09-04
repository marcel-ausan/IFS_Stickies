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
# It edits the XML IN PLACE inside the zip rather than re-zipping: Compress-Archive
# on Windows writes backslash entry paths, and IFS wrote forward slashes. A
# re-zipped package can fail to import.
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

# Anything matching these must not survive into a public package.
$SUSPECT = '(?i)dwre|DWRECFG'

$changed = 0
$flagged = 0

Get-ChildItem -Path $DEPLOY -Filter *.zip -File | ForEach-Object {
  $path = $_.FullName
  Write-Host "=== $($_.Name) ==="

  $zip = [System.IO.Compression.ZipFile]::Open($path, [System.IO.Compression.ZipArchiveMode]::Update)
  foreach ($entry in @($zip.Entries)) {
    $reader = New-Object IO.StreamReader($entry.Open())
    $text = $reader.ReadToEnd(); $reader.Close()
    $before = $text

    $text = [regex]::Replace($text, '<AUTHOR>[^<]*</AUTHOR>', "<AUTHOR>$AUTHOR</AUTHOR>")
    $text = [regex]::Replace($text, '<ORIGIN>[^<]*</ORIGIN>', "<ORIGIN>$ORIGIN</ORIGIN>")

    if ($text -ne $before) {
      $s = $entry.Open(); $s.SetLength(0)
      $w = New-Object IO.StreamWriter($s)   # no BOM, which IFS will not accept
      $w.Write($text); $w.Flush(); $w.Close(); $s.Close()
      Write-Host "  stamped: $($entry.FullName)"
      $changed++
    }

    # Descriptions and comments can carry a person or environment name too;
    # those are not rewritten automatically because they may be meaningful.
    foreach ($m in [regex]::Matches($text, $SUSPECT)) {
      Write-Host "  REVIEW: '$($m.Value)' still present in $($entry.FullName)" -ForegroundColor Yellow
      $flagged++
    }
  }
  $zip.Dispose()

  [IO.File]::Copy($path, (Join-Path $ASSETS $_.Name), $true)
  Write-Host "  copied to extension/assets/"
}

Write-Host ""
Write-Host "$changed file(s) stamped."
if ($flagged) {
  Write-Host "$flagged reference(s) need a manual look - see REVIEW lines above." -ForegroundColor Yellow
  exit 1
}
Write-Host "No environment references left."
