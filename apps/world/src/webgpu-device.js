export class GraphicsUnavailableError extends Error {
  constructor(cause) {
    super('Graphics initialization is unavailable', { cause });
    this.name = 'GraphicsUnavailableError';
  }
}

export async function createWorldGraphicsDevice(pc, canvas, { timeoutMs = 10_000 } = {}) {
  let timer;
  try {
    const device = await Promise.race([
      pc.createGraphicsDevice(canvas, {
        deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
        powerPreference: 'high-performance'
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Graphics device initialization timed out')), timeoutMs);
      })
    ]);
    if (!device?.isWebGPU && !device?.isWebGL2)
      throw new Error('Graphics device is neither WebGPU nor WebGL2');
    return device;
  } catch (cause) {
    throw new GraphicsUnavailableError(cause);
  } finally {
    clearTimeout(timer);
  }
}
