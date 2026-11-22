"""All network state is an in-memory fixture owned by this browser test."""

import json
from urllib.parse import urlsplit
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_server_session_restore_and_retry(origin, browser):
    page = browser.new_page()
    errors, reads, writes, profiles = [], [], [], []
    online = False
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("""localStorage.setItem('inha-v01:nickname','"fixture"');
      localStorage.setItem('inha-v01:server-session','fixture-server');
      localStorage.setItem('inhaworld-firebase-session-v1','fixture-auth');""")

    def handle(route):
        req = route.request
        path = urlsplit(req.url).path
        if not req.url.startswith(origin + "/"):
            return route.abort()
        if not path.startswith("/api/"):
            return route.continue_()
        if path == "/api/health":
            return route.fulfill(json={"ok": True})
        if path in ["/api/rooms", "/api/quests"]:
            return route.fulfill(
                json=json.loads((ROOT / "data" / (path[5:] + ".json")).read_text())
            )
        if path == "/api/guestbook":
            return route.fulfill(json={"entries": []})
        if path == "/api/auth/firebase/me":
            assert req.headers["x-session-id"] == "fixture-auth"
            return route.fulfill(
                json={"ok": True, "email": "qa@example.invalid", "userId": "fixture-profile"}
            )
        if path == "/api/world-profile":
            profiles.append(req.headers.get("x-session-id"))
            return route.fulfill(json={"ok": True})
        if path == "/api/progress":
            assert req.headers["x-session-id"] == "fixture-server"
            if req.method == "GET":
                reads.append(online)
                if not online:
                    return route.fulfill(status=503, json={"error": "fixture"})
                return route.fulfill(
                    json={
                        "entries": [
                            {
                                "questId": "quest-gate-tour",
                                "status": "done",
                                "updatedAt": "2025-01-01",
                            }
                        ]
                    }
                )
            writes.append(req.post_data_json)
            return route.fulfill(json={"entry": {"status": "done", "updatedAt": "2026-01-01"}})
        raise AssertionError(path)

    page.route("**/*", handle)
    page.goto(origin)
    page.wait_for_function(
        "document.querySelector('#auth-status').textContent.includes('qa@example.invalid')"
    )
    page.locator("#room-list button").nth(0).click()
    assert not writes
    online = True
    page.locator("#save-nickname").click()
    page.wait_for_function("document.querySelector('#hud-quest').textContent.includes('1/3')")
    assert reads == [False, True] and not writes
    page.locator("#room-list button").nth(2).click()
    page.wait_for_function("document.querySelector('#hud-quest').textContent.includes('2/3')")
    assert writes == [{"questId": "quest-library-tour", "evidence": {"roomId": "library"}}]
    assert profiles == ["fixture-auth"]
    assert not errors
    page.close()


def test_logout_restored_session(origin, browser):
    page = browser.new_page()
    calls = []
    page.add_init_script("""localStorage.setItem('inhaworld-firebase-session-v1','test-device');""")

    def fixture(r):
        req = r.request
        if req.url.endswith("/firebase-app-compat.js"):
            return r.fulfill(
                content_type="application/javascript", body="window.firebase={apps:[{}]}"
            )
        if req.url.endswith("/firebase-auth-compat.js"):
            return r.fulfill(
                content_type="application/javascript",
                body="firebase.auth=()=>({signOut:async()=>window.signedOut=true})",
            )
        assert req.url.startswith(origin + "/")
        path = urlsplit(req.url).path
        if path == "/api/health":
            return r.fulfill(status=503, json={})
        if path == "/api/world-profile":
            return r.fulfill(json={})
        if path.startswith("/api/auth/firebase/"):
            assert req.headers["x-session-id"] == "test-device"
            calls.append([req.method, path])
            return r.fulfill(json={"ok": True})
        return r.continue_()

    page.route("**/*", fixture)
    page.goto(origin)
    page.wait_for_function(
        "document.querySelector('#auth-status').textContent.includes('로그인됨')"
    )
    assert page.evaluate("typeof window.firebase") == "undefined"
    page.locator("#auth-logout").click()
    page.wait_for_function("window.signedOut === true")
    assert page.evaluate("localStorage.getItem('inhaworld-firebase-session-v1')") is None
    assert calls == [["GET", "/api/auth/firebase/me"], ["POST", "/api/auth/firebase/logout"]]
    page.close()
