<#
.SYNOPSIS
  Builds the Chrome Web Store upload zip in dist/.

.DESCRIPTION
  • Copies only the files the extension needs at runtime.
  • Removes the "key" field (the Web Store rejects it and assigns its own ID).
  • Optionally swaps in the OAuth client ID created for the Web Store item ID.
  • Writes a zip with forward-slash paths, which the Web Store requires.

.EXAMPLE
  # First upload (draft) to get your Web Store item ID:
  powershell -ExecutionPolicy Bypass -File scripts\build-store.ps1

  # Final build, with the OAuth client made for the store item ID:
  powershell -ExecutionPolicy Bypass -File scripts\build-store.ps1 -ClientId 1234-abc.apps.googleusercontent.com
#>
param(
  [string]$ClientId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

# Runtime files only (no README, rules, site, scripts, store assets).
$include = @(
  'manifest.json', 'background.js', 'firebase-config.js', 'friends.js',
  'popup.html', 'popup.css', 'popup.js'
)
$includeDirs = @('shared', 'content', 'icons')

$files = @()
foreach ($f in $include) { $files += Get-Item (Join-Path $root $f) }
foreach ($d in $includeDirs) { $files += Get-ChildItem (Join-Path $root $d) -Recurse -File }

# --- Manifest: drop "key", optionally set client_id -------------------------------
$manifestText = [IO.File]::ReadAllText((Join-Path $root 'manifest.json'))
$manifest = $manifestText | ConvertFrom-Json
$manifest.PSObject.Properties.Remove('key')
if ($ClientId) {
  if ($ClientId -notmatch '\.apps\.googleusercontent\.com$') { throw "ClientId doesn't look like an OAuth client ID: $ClientId" }
  $manifest.oauth2.client_id = $ClientId
} else {
  Write-Warning "No -ClientId given: the zip keeps the dev client ID, so sign-in will only work after you rebuild with the store client ID."
}
$manifestOut = $manifest | ConvertTo-Json -Depth 20

$version = $manifest.version
$zipPath = Join-Path $dist "daily-games-tracker-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($file in $files) {
    $rel = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
      if ($rel -eq 'manifest.json') {
        $bytes = $utf8.GetBytes($manifestOut)
      } else {
        $bytes = [IO.File]::ReadAllBytes($file.FullName)
      }
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
  }
} finally { $zip.Dispose() }

Write-Host "Built $zipPath ($($files.Count) files, version $version)"
if ($ClientId) { Write-Host "client_id: $ClientId" }
