param(
  [Parameter(Mandatory = $true)][string]$ServerPublicKey,
  [Parameter(Mandatory = $true)][string]$ClientAddress,
  [Parameter(Mandatory = $true)][string]$OutputFile
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputFile) { throw "Refusing to overwrite $OutputFile" }
$wg = Join-Path ${env:ProgramFiles} 'WireGuard\wg.exe'
if (-not (Test-Path -LiteralPath $wg)) { $wg = 'wg.exe' }
$privateKey = (& $wg genkey).Trim()
$publicKey = ($privateKey | & $wg pubkey).Trim()
$config = @"
[Interface]
PrivateKey = $privateKey
Address = $ClientAddress
DNS = 1.1.1.1

[Peer]
PublicKey = $ServerPublicKey
Endpoint = 0.0.0.0:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
"@
[IO.File]::WriteAllText((Join-Path (Get-Location) $OutputFile), $config, [Text.UTF8Encoding]::new($false))
& icacls $OutputFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
Remove-Variable privateKey
Write-Output "Client public key: $publicKey"
