"""Run with pytest in an environment with Python Playwright and Chromium."""

import pytest


@pytest.mark.parametrize("auth_status", [401, 503])
def test_guest_world_survives_auth_failure(origin, browser, auth_status):
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    errors, auth_headers = [], []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    def network(route):
        req = route.request
        if req.url == origin + "/api/auth/firebase/me":
            auth_headers.append(req.headers.get("x-session-id"))
            return route.fulfill(status=auth_status, json={"error": "fixture"})
        if req.url == origin + "/api/health":
            return route.fulfill(status=503, json={})
        if req.url.startswith(origin + "/"):
            return route.continue_()
        return route.abort()

    page.route("**/*", network)
    page.add_init_script("""window.firebase={apps:[{}], auth:()=>({})};
        localStorage.setItem('inhaworld-firebase-session-v1','test-device');""")
    page.goto(origin)
    page.wait_for_function("document.querySelector('#hud-mode').textContent.includes('로컬 모드')")
    page.wait_for_function(
        "document.querySelector('#auth-status').textContent.includes('"
        + ("만료" if auth_status == 401 else "연결할 수 없")
        + "')"
    )
    assert auth_headers == ["test-device"]
    assert page.evaluate("localStorage.getItem('inhaworld-firebase-session-v1')") == (
        None if auth_status == 401 else "test-device"
    )
    assert page.locator("#auth-profile-row").is_hidden()
    assert page.locator("#scene").evaluate("c=>!!c.getContext('webgl2') && c.width>0")
    old = page.locator("#hud-pos").inner_text()
    page.keyboard.down("w")
    page.wait_for_function("old=>document.querySelector('#hud-pos').textContent!==old", arg=old)
    page.keyboard.up("w")
    assert not errors
    page.close()
