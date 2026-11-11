import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Stage a private copy where the LocalSystem tunnel service can read it. */
export async function stageWindowsConfig(source: string): Promise<string> {
  const directory = join(process.env.ProgramData ?? 'C:\\ProgramData', 'PTCGL-VPN-Manager', 'WireGuard');
  const target = join(directory, basename(source));
  if (source.toLowerCase() === target.toLowerCase()) throw new Error('Use a client configuration outside the service staging directory');
  await fs.mkdir(directory, { recursive: true });
  // Create an empty file first; do not write a private key until its DACL is set.
  await (await fs.open(target, 'a', 0o600)).close();
  const encode = (value: string) => Buffer.from(value, 'utf16le').toString('base64');
  const command = [
    "$ErrorActionPreference='Stop'",
    "$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$sids=@($owner,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))",
    "$directory=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + encode(directory) + "'))",
    "$target=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + encode(target) + "'))",
    "$folderAcl=[System.Security.AccessControl.DirectorySecurity]::new()",
    "$folderAcl.SetOwner($owner)",
    "$folderAcl.SetAccessRuleProtection($true,$false)",
    "$fileAcl=[System.Security.AccessControl.FileSecurity]::new()",
    "$fileAcl.SetOwner($owner)",
    "$fileAcl.SetAccessRuleProtection($true,$false)",
    "foreach($sid in $sids) { $folderAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')); $fileAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')) }",
    "[System.IO.Directory]::SetAccessControl($directory,$folderAcl)",
    "[System.IO.File]::SetAccessControl($target,$fileAcl)"
  ].join('; ');
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(command)], { windowsHide: true, timeout: 15000 });
  const config = await fs.readFile(source);
  try { await fs.writeFile(target, config); } finally { config.fill(0); }
  return target;
}
