$ErrorActionPreference = 'Stop'
$root = $env:CORTISOL_INSTALL_DIR
if (!$root) { throw 'Missing install directory' }
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop 'Cortisol.x.lnk'))
$link.TargetPath = Join-Path $root 'node_modules\electron\dist\electron.exe'
$link.Arguments = '"' + $root.TrimEnd('\') + '"'
$link.IconLocation = (Join-Path $root 'assets\app.ico') + ',0'
$link.WindowStyle = 7
$link.WorkingDirectory = $root
$link.Description = 'Cortisol.x Solana shadow terminal'
$link.Save()

$programs = [Environment]::GetFolderPath('Programs')
Copy-Item -LiteralPath (Join-Path $desktop 'Cortisol.x.lnk') -Destination (Join-Path $programs 'Cortisol.x.lnk') -Force
