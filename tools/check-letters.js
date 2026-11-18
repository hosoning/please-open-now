/**
 * letters.json 结构与文案校验。用法：node tools/check-letters.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '../letters.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);

const themeIds = ['happy','wronged','miss','sleepless','date','tired','encourage','celebrate','calm','thanks','messy','surprise'];
ok('parses and has 12 themes', Array.isArray(data.themes) && data.themes.length === 12);
ok('theme ids unchanged', data.themes.every((t, i) => t.id === themeIds[i]), data.themes.map(t => t.id).join(','));

const titles = [], bodies = [], ids = [];
const styles = new Set(['温柔','克制','安静','直接','俏皮']);
const FORBIDDEN = ['不必','不用急着','已经很好了','就这样挺好','值得被看见','放着就好','你值得','慢慢来','先放着','明天再说'];
const issues = [];
for (const t of data.themes) {
  ok(`${t.id} has 10 letters`, Array.isArray(t.letters) && t.letters.length === 10, String((t.letters||[]).length));
  (t.letters || []).forEach((l, i) => {
    const expect = `${t.id}_${String(i + 1).padStart(3, '0')}`;
    if (l.id !== expect) issues.push(`id ${l.id} != ${expect}`);
    ids.push(l.id); titles.push(l.title); bodies.push(l.body);
    if (!styles.has(l.style)) issues.push(`style ${l.id} ${l.style}`);
    const n = (l.body || '').length;
    if (n < 90 || n > 160) issues.push(`len ${l.id} ${n}`);
    for (const f of FORBIDDEN) {
      if ((l.body || '').includes(f) || (l.title || '').includes(f)) issues.push(`slogan ${l.id} ${f}`);
    }
    if ((l.title || '').trim() === '我在' || /我在[。！]?$/.test((l.body || '').trim())) issues.push(`end 我在 ${l.id}`);
    if ((l.body || '').includes('你们') || (l.title || '').includes('你们')) issues.push(`你们 ${l.id}`);
    const sub = (l.body || '').replace(/你/g, '小雨');
    if (sub.includes('小雨们') || sub.includes('小雨好') || sub.includes('小雨我')) issues.push(`name-sub ${l.id}`);
  });
}
ok('120 letters', ids.length === 120, String(ids.length));
ok('unique ids', ids.length === new Set(ids).size);
ok('unique titles', titles.length === new Set(titles).size);
ok('unique bodies', bodies.length === new Set(bodies).size);
ok('body length / style / slogans / name-sub', issues.length === 0, issues.slice(0, 8).join(' | '));
const lens = bodies.map((b) => b.length);
ok('length range reported', true, `${Math.min(...lens)}–${Math.max(...lens)} avg ${Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)}`);

console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
