"""Pure GPU QA gate policy. Preflight never substitutes for game-render QA."""

from __future__ import annotations


def evaluate_probe(probe: dict | None) -> dict:
    """Return preflight readiness, preserving the distinction from scene PASS."""
    if not isinstance(probe, dict) or probe.get('browser_error'):
        return {
            'status': 'BLOCKED_BROWSER',
            'render_qa': 'NOT_RUN',
            'offline_qa': 'AVAILABLE_SEPARATELY',
            'reason': 'Browser could not start or capability probe did not run.',
        }
    webgl = probe.get('webgl2') or {}
    webgpu = probe.get('webgpu') or {}
    if webgpu.get('device_created') is True:
        backend = 'WEBGPU'
    elif webgl.get('context_created') is True and webgl.get('pixel_check') is True:
        backend = 'WEBGL2'
    else:
        return {
            'status': 'BLOCKED_GPU',
            'render_qa': 'NOT_RUN',
            'offline_qa': 'AVAILABLE_SEPARATELY',
            'reason': 'Neither a usable WebGL2 drawing context nor a WebGPU device was available.',
        }
    return {
        'status': 'READY_RENDER_QA',
        'backend': backend,
        'render_qa': 'NOT_RUN',
        'offline_qa': 'AVAILABLE_SEPARATELY',
        'reason': 'GPU preflight succeeded; run an actual game-scene visual E2E before claiming render PASS.',
    }


def choose_route(probe: dict | None, *, allow_software: bool = False, trusted_local: bool = False) -> dict:
    gate = evaluate_probe(probe)
    if gate['status'] == 'READY_RENDER_QA':
        return {'route': 'BROWSER_SCENE_QA', **gate}
    if gate['status'] == 'BLOCKED_GPU' and allow_software and trusted_local:
        return {'route': 'TRY_SOFTWARE_WEBGL_THEN_OFFLINE', **gate}
    return {'route': 'OFFLINE_QA_AND_EXTERNAL_REAL_GPU', **gate}


def is_trusted_local_url(value: str | None) -> bool:
    """Only literal loopback hosts are eligible for the unsafe SwiftShader opt-in."""
    if not value:
        return True
    from urllib.parse import urlsplit
    try:
        parsed = urlsplit(value)
        return parsed.scheme in {'http', 'https'} and parsed.hostname in {'localhost', '127.0.0.1', '::1'} and not parsed.username and not parsed.password
    except ValueError:
        return False
