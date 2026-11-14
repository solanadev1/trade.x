$ErrorActionPreference = 'Stop'
$root = $env:CORTISOL_INSTALL_DIR
if (!$root) { throw 'Missing install directory' }
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop 'Cortisol.x.lnk'))
$link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$link.Arguments = '//nologo "' + (Join-Path $root 'Launch_Silent.vbs') + '"'
$link.WindowStyle = 7
$link.WorkingDirectory = $root
$link.Description = 'Cortisol.x Solana shadow terminal'
$link.Save()
