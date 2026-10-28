#!/usr/bin/env python3
"""Isolated browser GPU preflight for Code, Cloud and INHA WORLD local QA.

Depends on playwright (pip install playwright; playwright install chromium).
This is a read-only capability check. It does not prove a game rendered correctly.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from policy import choose_route, evaluate_probe, is_trusted_local_url

BROWSER_PROBE_JS = r"""async (timeoutMs) => {
  const result = {
    webgl2: { context_created: false, pixel_check: false },
    webgpu: { api_present: !!navigator.gpu, adapter_created: false, device_created: false },
    secure_context: isSecureContext,
  };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (gl) {
      result.webgl2.context_created = true;
      result.webgl2.renderer = gl.getParameter(gl.RENDERER);
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) result.webgl2.backend = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      gl.viewport(0, 0, 4, 4);
      gl.clearColor(0.2, 0.6, 0.4, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const bytes = new Uint8Array(4);
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      result.webgl2.pixel_check = [51, 153, 102, 255].every((x, i) => Math.abs(bytes[i]-x) <= 2)
        && gl.getError() === gl.NO_ERROR;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (err) { result.webgl2.error = String(err?.message || err).slice(0, 300); }
  if (navigator.gpu && isSecureContext) {
    let device;
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('WEBGPU_TIMEOUT')), timeoutMs));
      const adapter = await Promise.race([navigator.gpu.requestAdapter(), timeout]);
      result.webgpu.adapter_created = !!adapter;
      if (adapter) {
        device = await Promise.race([adapter.requestDevice(), timeout]);
        result.webgpu.device_created = !!device;
      }
    } catch (err) { result.webgpu.error = String(err?.message || err).slice(0, 300); }
    finally { device?.destroy?.(); }
  }
  return result;
}"""


def probe_browser(*, url: str | None, browser_path: str | None, software: bool, timeout_ms: int) -> dict:
    from playwright.sync_api import sync_playwright

    result = {'mode': 'software-opt-in' if software else 'default', 'url_origin': None}
    if url:
        parsed = urlsplit(url)
        result['url_origin'] = f'{parsed.scheme}://{parsed.netloc}'
    args = ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] if software else []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=browser_path, args=args, timeout=timeout_ms)
            try:
                page = browser.new_page()
                if url:
                    page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
                result['browser_version'] = browser.version
                result['probe'] = page.evaluate(BROWSER_PROBE_JS, min(timeout_ms, 4000))
                result['app_present'] = page.evaluate('() => Boolean(window.__INHAGAME_P0__)')
            finally:
                browser.close()
    except Exception as exc:
        result['probe'] = {'browser_error': type(exc).__name__, 'error': str(exc).splitlines()[0][:250]}
    result['gate'] = evaluate_probe(result['probe'])
    return result


def run(args) -> dict:
    if args.software and not is_trusted_local_url(args.url):
        raise ValueError('Unsafe SwiftShader opt-in is restricted to about:blank or a literal loopback URL')
    if args.url:
        parsed = urlsplit(args.url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('URL must be a valid HTTP(S) URL without embedded credentials')
    runs = [probe_browser(url=args.url, browser_path=args.browser_path, software=False, timeout_ms=args.timeout_ms)]
    if args.software and runs[0]['gate']['status'] == 'BLOCKED_GPU':
        runs.append(probe_browser(url=args.url, browser_path=args.browser_path, software=True, timeout_ms=args.timeout_ms))
    selected = runs[-1]
    return {
        'schema_version': 1,
        'kind': 'gpu-preflight-not-visual-e2e',
        'generated_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
        'mode': 'software-opt-in' if args.software else 'default',
        'runs': runs,
        'decision': choose_route(selected['probe'], allow_software=False),
        'claims': {'gpu_preflight': selected['gate']['status'], 'world_rendering': 'NOT_RUN', 'mobile_device': 'NOT_RUN'},
        'recommended_offline_command': 'node apps/world/qa.mjs',
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Preflight GPU capability without claiming 3D visual PASS')
    parser.add_argument('--url', help='Optional running local app URL; if absent, test about:blank')
    parser.add_argument('--software', action='store_true', help='Opt in to unsafe SwiftShader ONLY on trusted local URLs')
    parser.add_argument('--browser-path', default=os.environ.get('GPU_QA_CHROMIUM_PATH'), help='Existing Chromium binary')
    parser.add_argument('--timeout-ms', type=int, default=12000)
    parser.add_argument('--output', default='gpu-preflight-report.json', help='Path for JSON evidence')
    parser.add_argument('--strict', action='store_true', help='Return status 2 when GPU is unavailable')
    args = parser.parse_args()
    if args.timeout_ms < 1000 or args.timeout_ms > 120000:
        parser.error('--timeout-ms must be between 1000 and 120000')
    try:
        report = run(args)
    except ValueError as exc:
        parser.error(str(exc))
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"{report['claims']['gpu_preflight']}: {report['decision']['route']} -> {out}")
    return 2 if args.strict and report['claims']['gpu_preflight'] != 'READY_RENDER_QA' else 0


if __name__ == '__main__':
    raise SystemExit(main())
