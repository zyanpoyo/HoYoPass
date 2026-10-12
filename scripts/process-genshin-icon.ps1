Add-Type -AssemblyName System.Drawing

$sourceUrl = "https://app-story.net/wp-content/uploads/2021/10/IMG_5905.jpg"
$destDir = "$PSScriptRoot\..\assets\icons"
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
$tempJpg = "$destDir\temp_genshin_source.jpg"
$finalPng = "$destDir\genshin.png"

Write-Host "Downloading standard Genshin icon source..."
Invoke-WebRequest -Uri $sourceUrl -OutFile $tempJpg

$src = [System.Drawing.Bitmap]::FromFile($tempJpg)
$size = 512
$dest = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($dest)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# 角丸パス定義 (512x512に対して半径115px、約22.5%)
$radius = 115
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$diameter = $radius * 2
$path.AddArc(0, 0, $diameter, $diameter, 180, 90)
$path.AddArc($size - $diameter, 0, $diameter, $diameter, 270, 90)
$path.AddArc($size - $diameter, $size - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc(0, $size - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()

$g.SetClip($path)

# 元画像（419x426）から白余白を除外したアイコン本体（X=29, Y=32, 幅=352, 高さ=352）を描画
$srcRect = New-Object System.Drawing.Rectangle 29, 32, 352, 352
$destRect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

$g.Dispose()
$dest.Save($finalPng, [System.Drawing.Imaging.ImageFormat]::Png)
$dest.Dispose()
$src.Dispose()

Remove-Item $tempJpg -Force
Write-Host "[SUCCESS] Generated clean Genshin icon: $finalPng (512x512 Transparent PNG)"
