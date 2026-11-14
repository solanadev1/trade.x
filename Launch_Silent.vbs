Option Explicit
Dim shell, fso, folder, executable
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
executable = fso.BuildPath(folder, "node_modules\electron\dist\electron.exe")
If Not fso.FileExists(executable) Then
  MsgBox "Run First_Time_Setup.bat first to install Cortisol.x.", 48, "Cortisol.x"
  WScript.Quit 1
End If
shell.CurrentDirectory = folder
shell.Run Chr(34) & executable & Chr(34) & " " & Chr(34) & folder & Chr(34), 0, False
