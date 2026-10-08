// Optional emergency path only. Normal harness.close ordering stays unchanged.
// Stop only this harness's owned dev-server before an independent browser close.
export async function abortSmokeResources({ stopServer, browser }) {
  stopServer();
  await browser.close();
}

// Startup errors occur before the caller owns a smoke handle. Stop this server
// immediately and bound the partial browser cleanup without hiding that error.
export async function cleanupFailedSmokeStart({ stopServer, browser }, { timeoutMs = 5_000 } = {}) {
  stopServer();
  if (!browser) return 'not-started';
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => browser.close()).then(() => 'complete'),
      new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); })
    ]);
  } catch {
    // The caller rethrows the original launch/context setup error.
    return 'failed';
  } finally { clearTimeout(timer); }
}

// The startup owner keeps the server/browser handles even when its optional
// deadline wins. A late launcher result is closed rather than handed to setup.
export async function startSmokeResources({ launchBrowser, setupContext, stopServer }, { timeoutMs, cleanupTimeoutMs = 5_000 } = {}) {
  let browser, failure, timer;
  const ensureActive = () => { if (failure) throw failure; };
  const startup = Promise.resolve().then(launchBrowser).then(async launched => {
    if (failure) {
      await cleanupFailedSmokeStart({ stopServer: () => {}, browser: launched }, { timeoutMs: cleanupTimeoutMs });
      throw failure;
    }
    browser = launched;
    const context = await setupContext(browser, ensureActive);
    ensureActive();
    return { browser, context };
  });
  try {
    if (timeoutMs === undefined) return await startup;
    return await Promise.race([
      startup,
      new Promise((_, reject) => { timer = setTimeout(() => {
        failure = new Error(`smoke startup timed out after ${timeoutMs} ms`);
        failure.code = 'SMOKE_STARTUP_TIMEOUT';
        reject(failure);
      }, timeoutMs); })
    ]);
  } catch (error) {
    clearTimeout(timer);
    failure = error;
    error.startupCleanup = await cleanupFailedSmokeStart({ stopServer, browser }, { timeoutMs: cleanupTimeoutMs });
    throw error;
  } finally { clearTimeout(timer); }
}
