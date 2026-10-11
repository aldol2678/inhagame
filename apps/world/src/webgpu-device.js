export class GraphicsUnavailableError extends Error {
  constructor(cause) {
    super('Graphics initialization is unavailable', { cause });
    this.name = 'GraphicsUnavailableError';
  }
}

export async function createWorldGraphicsDevice(pc, canvas, { timeoutMs = 0 } = {}) {
  let timer;
  try {
    // The campus watchdog offers manual recovery while initialization is pending.
    // A slow GPU/driver is not a confirmed failure; explicit callers may opt into a deadline.
    const pending = pc.createGraphicsDevice(canvas, {
      deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
      powerPreference: 'high-performance'
    });
    const device = await (timeoutMs > 0 ? Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Graphics device initialization timed out')), timeoutMs);
      })
    ]) : pending);
    if (!device?.isWebGPU && !device?.isWebGL2)
      throw new Error('Graphics device is neither WebGPU nor WebGL2');
    return device;
  } catch (cause) {
    throw new GraphicsUnavailableError(cause);
  } finally {
    clearTimeout(timer);
  }
}
