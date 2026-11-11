// Terminal-Design launcher. Copied to %LOCALAPPDATA%\TerminalDesign\launcher.js by the
// installer; rewritten on every install. Do not edit the installed copy.
//
// Reads current.json next to this file and runs versions\<version>\bin\td.js with the same
// arguments. If the current version cannot be loaded, falls back to the previous one and
// prints a warning on stderr (stdout stays clean for the Claude Code status line).
// Plain CommonJS with no dependencies so it keeps working across every version.
'use strict';

var fs = require('fs');
var path = require('path');
var url = require('url');

var LAUNCHER_FORMAT = 1;
var SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
var home = __dirname;

var nv = process.versions.node.split('.').map(Number);
if (nv[0] < 18 || (nv[0] === 18 && nv[1] < 17)) {
  process.stderr.write('Terminal-Design precisa do Node.js 18.17 ou mais novo (encontrado ' + process.versions.node + '). Baixe em https://nodejs.org/pt-br/download\n');
  process.exit(1);
}

// Keep every part of the program pointed at this install, even with a custom location.
if (!process.env.TD_DATA_HOME) process.env.TD_DATA_HOME = home;
process.env.TD_LAUNCHER = String(LAUNCHER_FORMAT);

function readCurrent() {
  try {
    var raw = fs.readFileSync(path.join(home, 'current.json'), 'utf8').replace(/^﻿/, '');
    var cur = JSON.parse(raw);
    return cur && typeof cur === 'object' ? cur : {};
  } catch (e) {
    return {};
  }
}

function entryFor(v) {
  if (typeof v !== 'string' || !SEMVER.test(v)) return null;
  var file = path.join(home, 'versions', v, 'bin', 'td.js');
  return fs.existsSync(file) ? file : null;
}

async function start() {
  var cur = readCurrent();
  var candidates = [cur.version, cur.previous].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  var problems = [];
  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i];
    var file = entryFor(v);
    if (!file) { problems.push(v + ': arquivos não encontrados'); continue; }
    if (i > 0) {
      process.stderr.write('! Terminal-Design ' + candidates[0] + ' não pôde ser carregado (' + problems.join('; ') + ').\n' +
        '! Usando a versão anterior ' + v + '. Para fixar: td update --rollback, ou reinstale.\n');
    }
    try {
      await import(url.pathToFileURL(file).href);
      return;
    } catch (err) {
      problems.push(v + ': ' + ((err && err.message) || String(err)).split('\n')[0]);
      if (process.env.TD_DEBUG) console.error(err);
    }
  }
  process.stderr.write('✗ Terminal-Design: nenhuma versão instalada pôde ser carregada.\n' +
    (problems.length ? '  ' + problems.join('\n  ') + '\n' : '  current.json ausente ou inválido.\n') +
    '  Reinstale: powershell -ExecutionPolicy Bypass -File scripts\\install.ps1\n');
  process.exitCode = 1;
}

start();
