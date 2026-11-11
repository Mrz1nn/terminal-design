// JSON-lines protocol between Node and the native host (voice-host.cs).
//
//   host -> node   {"event":"ready","hotkey":"Ctrl+Alt+Space","mode":"push-to-talk","device":"..."}
//                  {"event":"recording","device":"..."}
//                  {"event":"audio","path":"C:\\...\\td-voice-123-1.wav","durationMs":2100,"peak":5400,"reason":"release"}
//                  {"event":"cancelled","reason":"short","durationMs":120}
//                  {"event":"typed","chars":12,"requested":12,"insertMode":"type"}
//                  {"event":"devices","devices":[{"index":0,"name":"Microfone (...)","channels":2}]}
//                  {"event":"warn"|"error","code":"...","message":"..."}
//                  {"event":"quit","reason":"tray"}
//   node -> host   {"cmd":"type","text":"olá ","insertMode":"type"}
//                  {"cmd":"state","state":"idle"|"processing"|"error","message":"..."}
//                  {"cmd":"quit"}

export const EVENTS = new Set(['ready', 'recording', 'audio', 'cancelled', 'typed', 'devices', 'warn', 'error', 'quit']);
export const COMMANDS = new Set(['type', 'state', 'quit']);

/** One line -> message object, or null when it is not a protocol message (noise, warnings). */
export function parseLine(line) {
  const s = String(line).replace(/^\uFEFF/, '').trim();
  if (!s.startsWith('{')) return null;
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (typeof obj.event === 'string' && EVENTS.has(obj.event)) return obj;
  return null;
}

/**
 * Incremental decoder for a byte/string stream: buffers partial lines across chunks.
 * onMessage(msg) for protocol messages, onOther(line) for anything else (logged in debug).
 */
export function createLineDecoder(onMessage, onOther = () => {}) {
  let buf = '';
  const decoder = new TextDecoder('utf-8');
  const handle = (line) => {
    if (!line.trim()) return;
    const msg = parseLine(line);
    if (msg) onMessage(msg);
    else onOther(line);
  };
  return {
    push(chunk) {
      buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        handle(line);
      }
    },
    end() {
      buf += decoder.decode();
      if (buf) handle(buf.replace(/\r$/, ''));
      buf = '';
    },
  };
}

/** Command object -> one line. Validates the command name. */
export function encodeCommand(cmd) {
  if (!cmd || !COMMANDS.has(cmd.cmd)) throw new Error(`comando de protocolo inválido: ${cmd?.cmd}`);
  // JSON.stringify never emits raw newlines inside strings, so one object = one line.
  return `${JSON.stringify(cmd)}\n`;
}
