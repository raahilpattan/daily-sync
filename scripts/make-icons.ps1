<#
.SYNOPSIS
  Generates every icon/logo PNG from the logo artwork in store/logo-source.jpg.

.DESCRIPTION
  The source is a wide image with the app tile centred in it. This script crops the tile,
  makes the area outside its rounded corners transparent, and writes:
    icons/icon16.png, icon32.png, icon48.png   full-bleed (toolbar, extensions page)
    icons/icon128.png                         96px artwork + 16px transparent padding
                                              (Chrome Web Store icon guideline)
    docs/logo.png (256), docs/favicon.png (64), docs/apple-touch-icon.png (180)

  If you replace the artwork, adjust $Tile (the tile's bounding box in the source) and $Radius.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#>
param(
  [string]$Source = (Join-Path (Split-Path -Parent $PSScriptRoot) 'store\logo-source.jpg')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

# Tile bounding box in the source image, measured on its 1px border line.
$Tile   = @{ X = 935; Y = 328; Size = 878 }
$Radius = 0.252   # corner radius as a fraction of the tile size (≈221px / 878px)

function New-RoundedPath([single]$x, [single]$y, [single]$s, [single]$r) {
  $d = 2 * $r
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $s - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $s - $d, $y + $s - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $s - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Set-HighQuality($g) {
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

# --- 1) Master: cropped tile with transparent rounded corners (1024px) ------------
$src = [System.Drawing.Bitmap]::FromFile($Source)
$M = 1024
$master = New-Object System.Drawing.Bitmap $M, $M, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$crop = New-Object System.Drawing.Bitmap $M, $M
$g = [System.Drawing.Graphics]::FromImage($crop); Set-HighQuality $g
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $M, $M), $Tile.X, $Tile.Y, $Tile.Size, $Tile.Size, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose()

$g = [System.Drawing.Graphics]::FromImage($master); Set-HighQuality $g
$g.Clear([System.Drawing.Color]::Transparent)
$brush = New-Object System.Drawing.TextureBrush $crop
$g.FillPath($brush, (New-RoundedPath 0 0 $M ($M * $Radius)))   # anti-aliased edge
$brush.Dispose(); $g.Dispose(); $crop.Dispose()

# --- 2) Resize helper ----------------------------------------------------------------
function Save-Icon([int]$size, [int]$pad, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp); Set-HighQuality $g
  $g.Clear([System.Drawing.Color]::Transparent)
  $art = $size - 2 * $pad
  # Downscale in halving steps for crisp small sizes.
  $cur = $master; $curSize = $M; $temps = @()
  while ($curSize / 2 -ge $art * 1.5) {
    $half = [int]($curSize / 2)
    $t = New-Object System.Drawing.Bitmap $half, $half, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $tg = [System.Drawing.Graphics]::FromImage($t); Set-HighQuality $tg
    $tg.DrawImage($cur, 0, 0, $half, $half); $tg.Dispose()
    $temps += $t; $cur = $t; $curSize = $half
  }
  $g.DrawImage($cur, $pad, $pad, $art, $art)
  $g.Dispose()
  $path = Join-Path $root $out
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $temps | ForEach-Object { $_.Dispose() }
  Write-Host ("{0,-24} {1,4}px  ({2} bytes)" -f $out, $size, (Get-Item $path).Length)
}

Save-Icon 16  0  'icons\icon16.png'
Save-Icon 32  0  'icons\icon32.png'
Save-Icon 48  0  'icons\icon48.png'
Save-Icon 128 16 'icons\icon128.png'
Save-Icon 256 0  'docs\logo.png'
Save-Icon 64  0  'docs\favicon.png'
Save-Icon 180 0  'docs\apple-touch-icon.png'

$master.Dispose()
