#!/usr/bin/env node
import { main } from '../packages/cli/src/index.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(`Terminal-Design precisa do Node.js 18.17 ou mais novo (encontrado ${process.versions.node}).`);
  process.exit(1);
}

main().then((code) => {
  process.exitCode = code;
});
