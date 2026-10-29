import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../src/wavedl_daemon/web/package.json', import.meta.url));
const ts = require('typescript');
const baseline = process.argv.includes('--baseline');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const tracked = git('ls-files', 'src/wavedl_daemon/web/app').trim().split('\n');
const added = baseline ? [] : git('ls-files', '--others', '--exclude-standard', 'src/wavedl_daemon/web/app').trim().split('\n');
const rows = [];

for (const file of new Set([...tracked, ...added])) {
  if (!/\.(json|ts|vue)$/.test(file)) continue;
  let source;
  try {
    source = baseline ? git('show', `HEAD:${file}`) : readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  } catch {
    continue;
  }
  if (file.endsWith('.json')) {
    const visit = (value, key = '') => {
      if (typeof value === 'string' && value.length > 80) rows.push({ file, key, length: value.length, text: value });
      else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) visit(child, key ? `${key}.${name}` : name);
    };
    visit(JSON.parse(source));
  } else {
    if (file.endsWith('.vue')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isStringLiteralLike(node) && node.text.length > 80) rows.push({ file, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, length: node.text.length, text: node.text });
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
}

console.log(JSON.stringify({ over80: rows.length, over160: rows.filter((row) => row.length > 160).length, rows }, null, 2));
