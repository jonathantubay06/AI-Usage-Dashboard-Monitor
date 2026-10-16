' Double-click to start AI Token Monitor with no console window, then open it in the browser.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\start.ps1""", 0, False
