import { framebufferEvidence } from './life-props-browser-helpers.mjs';

// PlayCanvas may leave a multisample/offscreen read framebuffer bound after render.
// Screenshots use the resolved default buffer: diagnostics must read that same buffer.
export function readIncomeResolvedFramebuffer(gl) {
  if (gl.isContextLost()) throw new Error('Income fixture WebGL context lost');
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const data = new Uint8Array(width * height * 4);
  const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
  }
  return { ...framebufferEvidence(data, width, height), glError: gl.getError(),
    contextLost: gl.isContextLost(), readbackFramebuffer: 'resolved-default' };
}
