$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$release = Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.version -like 'v22.*' -and $_.lts } | Select-Object -First 1
if (!$release) { throw 'Could not locate Node.js 22 LTS' }
$name = "node-$($release.version)-win-$arch"
$work = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $url = "https://nodejs.org/dist/$($release.version)"
  Invoke-WebRequest "$url/$name.zip" -OutFile "$work\node.zip" -UseBasicParsing
  $checksums = (Invoke-WebRequest "$url/SHASUMS256.txt" -UseBasicParsing).Content
  $line = $checksums -split "`n" | Where-Object { $_.Trim().EndsWith(" $name.zip") } | Select-Object -First 1
  if (!$line) { throw 'Missing Node checksum' }
  $expected = ($line.Trim() -split '\s+')[0]
  if ((Get-FileHash "$work\node.zip" -Algorithm SHA256).Hash -ne $expected) { throw 'Node download checksum mismatch' }
  Expand-Archive "$work\node.zip" -DestinationPath $work
  $destination = Join-Path $env:LOCALAPPDATA 'Cortisol.x\node'
  New-Item -ItemType Directory -Force $destination | Out-Null
  Copy-Item "$work\$name\*" $destination -Recurse -Force
} finally { Remove-Item $work -Recurse -Force }
