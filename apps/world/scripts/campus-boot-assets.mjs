import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const digest = data => createHash('sha256').update(data).digest('hex');

// These modules supplied the asynchronous map data in the physical iPad incident.
const layouts = [
  'back-approach-layout', 'back-gate-layout', 'back-west-layout', 'basic-campus',
  'campus-facilities', 'campus-road-layout', 'editor/main-gate-production',
  'library-garden-layout', 'pond-east-access-p1a', 'reality-adapter'
].map(name => '/src/' + name + '.js');

export function campusBootAssets(html) {
  const body = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(body, 'Missing campus import map');
  const { imports } = JSON.parse(body[1]);
  const engine = imports.playcanvas;
  assert.match(engine, /^\/(?!\/)/, 'Campus engine must load from the site itself');
  const main = html.match(/<script\b[^>]*\bdata-world-entry\b[^>]*\bdata-src="([^"]+)"/)?.[1];
  const recovery = html.match(/<script\b[^>]*\bsrc="(\/src\/lobby\/boot-recovery\.js[^"]*)"/)?.[1];
  assert.match(main ?? '', /^\/src\/main\.js\?v=[a-f0-9]{12}$/);
  assert.match(recovery ?? '', /^\/src\/lobby\/boot-recovery\.js\?v=[a-f0-9]{12}$/);
  for (const path of layouts) assert.ok(imports[path], 'Missing versioned campus geometry: ' + path);
  const geometry = Object.keys(imports).filter(path => path.startsWith('/src/'));
  for (const path of geometry) {
    const [name, version] = imports[path].split('?');
    assert.equal(name, path, 'Unexpected campus module alias');
    assert.match(version ?? '', /^v=[a-f0-9]{12}$/);
  }
  return {
    engine, geometry,
    urls: [engine, main, recovery, '/src/lobby/lobby-loading.js', '/src/webgpu-device.js',
      ...geometry.map(path => imports[path])]
  };
}
