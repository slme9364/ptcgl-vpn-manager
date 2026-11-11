!macro customInit
  ; A crashed/older build can leave Electron alive and lock app.asar.
  ; Close only this application's executable before install or repair.
  nsExec::ExecToLog 'taskkill /F /T /IM "PTCGL VPN Manager.exe"'
!macroend

!macro customUnInit
  ; The uninstaller needs the same protection against locked files.
  nsExec::ExecToLog 'taskkill /F /T /IM "PTCGL VPN Manager.exe"'
!macroend
