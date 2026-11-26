'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const failures = [];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const jsFiles = ['backend', 'frontend/js', 'tests', 'scripts'].flatMap(dir => walk(path.join(root, dir))).filter(file => file.endsWith('.js'));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${path.relative(root, file)}: ${result.stderr || result.stdout}`);
}
const app = fs.readFileSync(path.join(root, 'backend/app.js'), 'utf8');
for (const match of app.matchAll(/require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) {
  const route = path.join(root, 'backend/routes', `${match[1]}.js`);
  if (!fs.existsSync(route)) failures.push(`Mounted route is missing: ${path.relative(root, route)}`);
}
for (const file of walk(path.join(root, 'frontend')).filter(file => file.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const value = match[1].trim();
    if (!value || /^(?:https?:|data:|mailto:|tel:|#|javascript:|\/api\/)/i.test(value)) continue;
    const local = value.split(/[?#]/)[0];
    if (!local) continue;
    const resolved = local.startsWith('/') ? path.resolve(root, 'frontend', local.slice(1)) : path.resolve(path.dirname(file), local);
    if (!fs.existsSync(resolved)) failures.push(`${path.relative(root, file)} references missing asset ${value}`);
  }
}
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'backend/scripts/seed.js'), 'utf8');
if (!/CREATE TABLE invoice_sequences\s*\(/i.test(schema)) failures.push('Invoice sequence table missing from schema');
if (!/invoice_sequences/.test(seed)) failures.push('Seed script does not reset invoice sequence');
if (failures.length) {
  console.error(`Static verification failed (${failures.length} issue(s)):`);
  failures.forEach(item => console.error(` - ${item}`));
  process.exit(1);
}
console.log(`Static verification passed: ${jsFiles.length} JavaScript files, mounted routes, frontend local references and invoice sequence schema.`);
