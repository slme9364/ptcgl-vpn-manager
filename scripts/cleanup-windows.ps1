[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$RemoveSettings)

$ErrorActionPreference = 'Stop'
$productName = 'PTCGL VPN Manager'
$removed = [System.Collections.Generic.List[string]]::new()

Get-Process -Name $productName -ErrorAction SilentlyContinue | ForEach-Object {
  if ($PSCmdlet.ShouldProcess("process $($_.Id)", 'Stop')) {
    Stop-Process -Id $_.Id -Force
    $removed.Add("Process: $($_.Id)")
  }
}

$paths = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\PTCGL VPN Manager'),
  (Join-Path $env:LOCALAPPDATA 'Programs\@ptcgldesktop'),
  (Join-Path $env:LOCALAPPDATA 'ptcgl-vpn-manager-updater'),
  (Join-Path $env:LOCALAPPDATA '@ptcgldesktop-updater'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\PTCGL VPN Manager.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PTCGL VPN Manager.lnk'),
  (Join-Path $env:ProgramFiles 'PTCGL VPN Manager')
)

if (${env:ProgramFiles(x86)}) {
  $paths += Join-Path ${env:ProgramFiles(x86)} 'PTCGL VPN Manager'
}

if ($RemoveSettings) {
  $paths += @(
    (Join-Path $env:APPDATA 'ptcgl-vpn-manager'),
    (Join-Path $env:APPDATA 'PTCGL VPN Manager'),
    (Join-Path $env:LOCALAPPDATA 'ptcgl-vpn-manager')
  )
}

$paths | Sort-Object -Unique | ForEach-Object {
  if ($_ -and (Test-Path -LiteralPath $_) -and $PSCmdlet.ShouldProcess($_, 'Remove')) {
    Remove-Item -LiteralPath $_ -Recurse -Force
    $removed.Add("Path: $_")
  }
}

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

foreach ($root in $uninstallRoots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
    $entry = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
    if ($entry.DisplayName -match '^PTCGL VPN Manager(?: \d[^\r\n]*)?$' -and $PSCmdlet.ShouldProcess($_.PSPath, 'Remove uninstall registration')) {
      Remove-Item -LiteralPath $_.PSPath -Recurse -Force
      $removed.Add("Registry: $($_.PSPath)")
    }
  }
}

if ($removed.Count -eq 0) {
  Write-Host 'PTCGL VPN Managerのインストール残骸は見つかりませんでした。'
} else {
  Write-Host '削除しました:'
  $removed | ForEach-Object { Write-Host "  $_" }
}

if (-not $RemoveSettings) {
  Write-Host 'アプリ設定は保持しました。設定も消す場合は -RemoveSettings を付けて再実行してください。'
}
