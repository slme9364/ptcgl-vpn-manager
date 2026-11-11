!macro customCheckAppRunning
  ; electron-builder's default check searches every process whose path starts
  ; with $INSTDIR. That can falsely match helper or uninstaller processes.
  ; Target only this application's exact executable and continue if absent.
  nsExec::ExecToLog 'taskkill /F /T /IM "PTCGL VPN Manager.exe"'
  Sleep 500
!macroend
