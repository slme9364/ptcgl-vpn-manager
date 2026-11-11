export type WireSockEvent = { type: 'handshake' } | { type: 'error'; message: string };

export function parseWireSockEvent(line: string): WireSockEvent | undefined {
  let message = line.trim();
  let level = '';
  try {
    const record = JSON.parse(message.slice(message.indexOf('{'))) as { message?: string; log_level?: string };
    if (typeof record.message === 'string') message = record.message;
    level = record.log_level ?? '';
  } catch { /* The CLI also emits plain text. */ }
  if (/handshake response received/i.test(message)) return { type: 'handshake' };
  if (level === 'error' || /failed to run|unknown parameter|driver is not available/i.test(message)) {
    return { type: 'error', message: message.replace(/(?:PrivateKey|PresharedKey)\s*[:=].*/gi, '[key omitted]').replace(/[A-Za-z0-9+/]{43}=/g, '[key omitted]').slice(0, 400) };
  }
  return undefined;
}
