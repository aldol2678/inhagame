// Optional emergency path only. Normal harness.close ordering stays unchanged.
// Stop only this harness's owned dev-server before an independent browser close.
export async function abortSmokeResources({ stopServer, browser }) {
  stopServer();
  await browser.close();
}
