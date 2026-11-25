import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const ref = JSON.parse(readFileSync(process.argv[2], 'utf8')).files;
const names = Object.keys(ref), out = { total: names.length, match: 0, mismatch: [], error: [] };
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < names.length) {
    const name = names[i++];
    try {
      const { stdout } = await run('curl', ['--fail', '-sS', '--max-time', '30', 'https://inhagame.app/' + name.split('/').map(encodeURIComponent).join('/')], { encoding: 'buffer', maxBuffer: 64 << 20 });
      const h = createHash('sha256').update(stdout).digest('hex');
      if (h === ref[name]) out.match++; else out.mismatch.push({ name, expected: ref[name].slice(0, 12), actual: h.slice(0, 12), bytes: stdout.length });
    } catch (e) { out.error.push({ name, error: String(e.stderr || e.message).slice(0, 120) }); }
  }
}));
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log(JSON.stringify({ total: out.total, match: out.match, mismatch: out.mismatch.length, error: out.error.length }));
console.log(JSON.stringify(out.mismatch.slice(0, 25)), JSON.stringify(out.error.slice(0, 15)));
