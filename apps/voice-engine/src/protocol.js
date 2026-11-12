// JSON-lines protocol between Node and the native host (voice-host.cs).
//
//   host -> node   {"event":"ready","hotkey":"Ctrl+Shift+F9","mode":"push-to-talk","device":"..."}
//                  {"event":"recording","device":"..."}
//                  {"event":"audio","id":1,"path":"C:\\...\\td-voice-123-1.wav","durationMs":2100,"peak":5400,"reason":"release"}
//                  {"event":"cancelled","reason":"short","durationMs":120}
//                  {"event":"typed","id":1,"chars":12,"requested":12,"insertMode":"type"}
//                  {"event":"blocked","id":1,"outcome":"blocked"|"interrupted","reason":"focus"|"modifier"|"no-target"|"error","keys":"Ctrl","chars":0,"requested":12}
//                  {"event":"kept","id":1,"chars":12}       autoInsert off: text stored for copying, nothing typed
//                  {"event":"copied","chars":12}
//                  {"event":"devices","devices":[{"index":0,"name":"Microfone (...)","channels":2}]}
//                  {"event":"warn"|"error","code":"...","message":"..."}
//                  {"event":"quit","reason":"tray"}
//   node -> host   {"cmd":"type","id":1,"text":"olá ","insertMode":"type"}   at most once per id
//                  {"cmd":"drop","id":1}      recording will not be inserted (silence, nothing recognized)
//                  {"cmd":"keep","id":1,"text":"olá "}   autoInsert off: release the target, offer the text to copy
//                  {"cmd":"copy"}               copy the last transcription (user action)
//                  {"cmd":"state","state":"idle"|"processing"|"error","message":"..."}
//                  {"cmd":"quit"}

export const EVENTS = new Set(['ready', 'recording', 'audio', 'cancelled', 'typed', 'blocked', 'kept', 'copied', 'devices', 'warn', 'error', 'quit']);
export const COMMANDS = new Set(['type', 'keep', 'drop', 'copy', 'state', 'quit']);

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
