// VS Code integration: produces `workbench.colorCustomizations` for the integrated terminal.
// We do not edit VS Code's settings.json (it is JSONC with user comments); the user pastes the
// snippet or we write it to a standalone file they can open.
import { writeJsonAtomic } from '../../packages/core/src/index.js';
import { toVSCodeColors } from '../../packages/themes/src/index.js';

export function snippet(theme) {
  return { 'workbench.colorCustomizations': toVSCodeColors(theme) };
}

export function writeSnippet(theme, file) {
  writeJsonAtomic(file, snippet(theme));
  return file;
}
