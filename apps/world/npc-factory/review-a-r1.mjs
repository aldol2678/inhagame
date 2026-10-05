// Public fixture inspection is not a human review or approval recorder.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateDevRoster } from './dev-appearance.mjs';
if(process.argv.length>2)throw new Error('Public QA fixture inspection takes no approval flags');
const bytes=readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json',import.meta.url));
const roster=JSON.parse(readFileSync(new URL('./data/fixtures/public-roster.json',import.meta.url)));
const hash=createHash('sha256').update(bytes).digest('hex');
validateDevRoster(JSON.parse(bytes),roster,hash);
console.log('Synthetic public QA roster valid: 20 fictional NPCs; human approval is not asserted.');
