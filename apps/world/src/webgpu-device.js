export class GraphicsUnavailableError extends Error {
  constructor(cause) {
    super('Graphics initialization is unavailable', { cause });
    this.name = 'GraphicsUnavailableError';
    this.code = cause?.code === 'GRAPHICS_INIT_TIMEOUT' ? cause.code : 'GRAPHICS_INIT_FAILED';
  }
}

function destroyDevice(device) {
  try { device?.destroy?.(); } catch { /* Best-effort cleanup of a partial or late device. */ }
}

async function initializeDevice(pc, canvas, didTimeOut) {
  const options = { powerPreference: 'high-performance' };
  if (globalThis.navigator?.gpu) {
    let webgpu;
    try {
      webgpu = new pc.WebgpuGraphicsDevice(canvas, options);
      const device = await webgpu.initWebGpu();
      if (device?.isWebGPU) return device;
    } catch {
      // Try WebGL2 when the adapter, device or WebGPU context is unavailable.
    }
    destroyDevice(webgpu);
  }

  // PlayCanvas 2.22.4's combined factory can leave its promise pending when
  // the synchronous WebGL2 constructor throws after an async WebGPU failure.
  // Run the constructor inside this async function so the rejection is observed.
  if (didTimeOut()) return null;
  return new pc.WebglGraphicsDevice(canvas, options);
}

export async function createWorldGraphicsDevice(pc, canvas, { timeoutMs = 10_000 } = {}) {
  let timer;
  let timedOut = false;
  try {
    const pendingDevice = initializeDevice(pc, canvas, () => timedOut).then(device => {
      // Promise.race cannot cancel GPU initialization. Release a device that
      // completes after the watchdog has already rejected the startup.
      if (timedOut) destroyDevice(device);
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
    if (!device?.isWebGPU && !device?.isWebGL2) {
      destroyDevice(device);
      throw new Error('Graphics device is neither WebGPU nor WebGL2');
    }
    return device;
  } catch (cause) {
    throw new GraphicsUnavailableError(cause);
  } finally {
    clearTimeout(timer);
  }
}
