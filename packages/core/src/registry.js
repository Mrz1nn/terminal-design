// Module registry: the extension point for future plugins.
//
// A module is a plain object:
//   { id, kind: 'command' | 'widget' | 'integration', description, ...kindSpecificFields }
//
// Built-in modules register themselves at startup. A future plugin system only has to
// load external files and call register() with the same contract; nothing else changes.

const modules = new Map();

export function register(mod) {
  if (!mod || typeof mod.id !== 'string' || !mod.kind) throw new Error('module needs id and kind');
  const key = `${mod.kind}:${mod.id}`;
  if (modules.has(key)) throw new Error(`module already registered: ${key}`);
  modules.set(key, Object.freeze({ ...mod }));
  return mod;
}

export function get(kind, id) {
  return modules.get(`${kind}:${id}`);
}

export function list(kind) {
  return [...modules.values()].filter((m) => !kind || m.kind === kind);
}

/** Test helper. */
export function _reset() {
  modules.clear();
}
