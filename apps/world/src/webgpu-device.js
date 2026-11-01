export class GraphicsUnavailableError extends Error {
  constructor(cause) {
    super('Graphics initialization is unavailable', { cause });
    this.name = 'GraphicsUnavailableError';
    this.code = cause?.code === 'GRAPHICS_INIT_TIMEOUT' ? cause.code : 'GRAPHICS_INIT_FAILED';
  }
}

export async function createWorldGraphicsDevice(pc, canvas, { timeoutMs = 10_000 } = {}) {
  let timer;
  let timedOut = false;
  try {
    const pendingDevice = Promise.resolve(pc.createGraphicsDevice(canvas, {
      deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
      powerPreference: 'high-performance'
    })).then(device => {
      // Promise.race cannot cancel GPU initialization. Release a device that
      // completes after the watchdog has already rejected the startup.
      if (timedOut) {
        try { device?.destroy?.(); } catch { /* best-effort late cleanup */ }
      }
      return device;
    });
    const device = await Promise.race([
      pendingDevice,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(Object.assign(new Error('Graphics device initialization timed out'), { code: 'GRAPHICS_INIT_TIMEOUT' }));
        }, timeoutMs);
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
