import { existsSync, promises as fs } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectClientConfig, redactDiagnosticText, type AppSettings, type DiagnosticReport } from '@ptcgl/core';
const exec = promisify(execFile);
const encoded = (text: string) => Buffer.from(text, 'utf16le').toString('base64');
const windowsScript = async (text: string) => (await exec('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',encoded(text)], { windowsHide: true, timeout: 10000 })).stdout.trim();

export async function gameProcessIds(executable: string): Promise<number[]> {
  if (!executable) return [];
  if (process.platform === 'win32') {
    const code = "$ErrorActionPreference='Stop'; $env:PSModulePath=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules'; " +
      "$file=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + encoded(executable) + "')); " +
      "$updater=[IO.Path]::Combine([IO.Path]::GetDirectoryName($file),'Updater')+'\\'; " +
      "$ids=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -eq $file -or ($_.Name -eq 'Updater.exe' -and $_.ExecutablePath.StartsWith($updater,[StringComparison]::OrdinalIgnoreCase))) } | ForEach-Object { $_.ProcessId }); " +
      "ConvertTo-Json -InputObject $ids -Compress";
    const data: unknown = JSON.parse(await windowsScript(code));
    return Array.isArray(data) ? data.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  }
  const { stdout } = await exec('/bin/ps', ['-axo','pid=,comm='], { timeout: 5000 });
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    return match && (match[2] === executable || match[2] === basename(executable)) ? [Number(match[1])] : [];
  });
}

export async function detectGame(home: string): Promise<string> {
  const candidates = process.platform === 'win32' ? [
    join(process.env.ProgramFiles ?? 'C:\\Program Files','Pokemon Trading Card Game Live','Pokemon TCG Live.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files','Pokémon Trading Card Game Live','Pokemon TCG Live.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs','Pokemon Trading Card Game Live','Pokemon TCG Live.exe')
  ] : ['/Applications/Pokemon TCG Live.app/Contents/MacOS/Pokemon TCG Live',join(home,'Applications','Pokemon TCG Live.app','Contents','MacOS','Pokemon TCG Live')];
  if (process.platform === 'win32') {
    try {
      const code = "$env:PSModulePath=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules'; $items=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^Pok.mon.*Live' -and $_.InstallLocation } | ForEach-Object { $_.InstallLocation }); ConvertTo-Json -InputObject $items -Compress";
      const locations: unknown = JSON.parse(await windowsScript(code));
      if (Array.isArray(locations)) for (const location of locations) if (typeof location === 'string') candidates.push(join(location,'Pokemon TCG Live.exe'),join(location,'Pokémon Trading Card Game Live','Pokemon TCG Live.exe'),join(location,'Pokemon Trading Card Game Live','Pokemon TCG Live.exe'));
    } catch { /* Standard paths are still useful without registry access. */ }
  }
  return candidates.find(existsSync) ?? '';
}

function clientExists(client: AppSettings['vpnClient']): boolean {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const known = client === 'wiresock' ? [
    join(programFiles,'WireSock Secure Connect','sdk','wiresock-client.exe'),
    join(programFiles,'WireSock Secure Connect','wiresock-client.exe'),
    join(programFiles,'WireSock VPN Client','wiresock-client.exe')
  ] : process.platform === 'win32' ? [join(programFiles,'WireGuard','wireguard.exe')] : ['/opt/homebrew/bin/wg-quick','/usr/local/bin/wg-quick'];
  const name = client === 'wiresock' ? 'wiresock-client.exe' : process.platform === 'win32' ? 'wireguard.exe' : 'wg-quick';
  return [...known,...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(directory => join(directory,name))].some(existsSync);
}

export async function localDiagnostics(settings: AppSettings): Promise<DiagnosticReport> {
  const checks: DiagnosticReport['checks'] = [];
  const add = (id: string,title: string,ok: boolean,yes: string,no: string) => checks.push({id,title,status:ok?'ok':'error',detail:ok?yes:no});
  add('game','PTCGL実行ファイル',!!settings.ptcglExecutable && existsSync(settings.ptcglExecutable),'実行ファイルを確認しました。','設定画面から実行ファイルを選択してください。');
  add('client','VPNクライアント',clientExists(settings.vpnClient),settings.vpnClient === 'wiresock'?'WireSock CLIを確認しました。':'WireGuardを確認しました。','選択したVPNクライアントが見つかりません。');
  if (process.platform === 'win32') {
    try {
      const admin = await windowsScript("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)");
      add('admin','管理者権限',admin.toLowerCase()==='true','パケットフィルター／トンネルを操作できます。','VPNを使う場合はManagerを管理者として起動してください。');
    } catch { checks.push({id:'admin',title:'管理者権限',status:'warning',detail:'権限を確認できませんでした。'}); }
  }
  try {
    const physical = await fs.realpath(settings.wireGuardConfigPath);
    const virtualized = /[\\/]LocalCache[\\/]/i.test(physical);
    checks.push({id:'config',title:'接続設定ファイル',status:virtualized?'warning':'ok',detail:virtualized?'仮想化された場所です。Documentsなど通常の場所にあるファイルを選び直してください。':'ファイルを読み取れます。'});
    checks.push(...inspectClientConfig(await fs.readFile(settings.wireGuardConfigPath,'utf8')));
  } catch { checks.push({id:'config',title:'接続設定ファイル',status:'error',detail:'設定ファイルを読み取れません。保存場所とアクセス権を確認してください。'}); }
  const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(process.env.APPDATA || join(process.env.HOME ?? '', '.config'),'gcloud','application_default_credentials.json');
  add('credentials','Google Cloud認証ファイル',existsSync(adc),'認証ファイルがあります。有効性と権限はクラウド確認で検証します。','この端末で gcloud auth application-default login を実行してください。');
  add('target','GCP接続先',!!settings.projectId && !!settings.instanceName && !!settings.zone,'プロジェクト・VM・ゾーンが指定されています。','Project ID・VM名・ゾーンを設定してください。');
  return {checkedAt:new Date().toISOString(),checks};
}

export function diagnosticError(error: unknown, settings: AppSettings): string {
  return redactDiagnosticText(error instanceof Error ? error.message : String(error),[settings.projectId,settings.instanceName]);
}
