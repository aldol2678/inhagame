import { createFixtureFetch, PUBLIC_ENV } from './collection-book-fixture.mjs';

if (!process.send || !/^v22\./.test(process.version) ||
  Object.entries(PUBLIC_ENV).some(([key, value]) => process.env[key] !== value)) {
  throw Error('COLLECTION_FIXTURE_RUNTIME_REQUIRED');
}
const counts = {};
Object.defineProperty(globalThis, 'fetch', { configurable: false, writable: false,
  value: createFixtureFetch(({ kind }) => { counts[kind] = (counts[kind] ?? 0) + 1; }) });
process.on('message', message => {
  if (message?.type === 'audit-snapshot' && Number.isSafeInteger(message.id)) {
    process.send({ type: 'audit-snapshot', id: message.id, counts: { ...counts } });
  }
});
process.send({ type: 'fixture-runtime', node: process.version, platform: process.platform, arch: process.arch });
