// Independent acceptance for the approved blue-body/dark-eye palette. Comparing
// source and optimized images alone cannot reject two identically white models.
export function assertAnnyongiColorSamples({ body, eyes }, assert) {
  const rgb = value => Array.isArray(value) && value.length === 3 && value.every(v => Number.isFinite(v) && v >= 0 && v <= 255);
  assert.ok(Array.isArray(body) && body.length === 2 && body.every(rgb), 'two finite skin RGB samples');
  assert.ok(Array.isArray(eyes) && eyes.length === 2 && eyes.every(rgb), 'two finite eye RGB samples');
  const luminance = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
  for (const [r, g, b] of body) {
    assert.ok(b - r >= 8 && g - r >= 5, 'skin retains authored blue chroma; neutral white/grey is not acceptable');
    assert.ok(luminance([r, g, b]) >= 35, 'skin remains readable');
  }
  const skin = body.reduce((sum, color) => sum + luminance(color), 0) / body.length;
  for (const eye of eyes) assert.ok(luminance(eye) <= skin * .45, 'each eye remains distinctly dark against the blue skin');
}
