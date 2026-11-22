"""Exercise the canonical URL selector entirely in Chromium's request interceptor."""

import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://inhagame.app"
SYNC = "https://inha-v01-sync.aldol-lab.workers.dev"


def test_sync_ownership_and_auth_denial(browser):
    page = browser.new_page()
    events, errors = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("""window.firebase={apps:[{}],auth:()=>({
      signInAnonymously:async()=>({user:{getIdToken:async()=>'fixture-only'}})
    })};""")

    def fixture(route):
        req = route.request
        u = urlsplit(req.url)
        path = u.path
        if req.url.startswith(SITE + "/") and not path.startswith("/api/"):
            file = (ROOT / (path.strip("/") or "index.html")).resolve()
            assert file.is_relative_to(ROOT)
            if not file.is_file():
                return route.fulfill(status=404)
            return route.fulfill(
                body=file.read_bytes(),
                content_type=mimetypes.guess_type(file)[0] or "application/octet-stream",
            )
        if req.url == SITE + "/api/auth/firebase/login":
            assert req.method == "POST"
            events.append(("firebase", 401))
            return route.fulfill(status=401, json={"error": "TEST_TOKEN_DENIED"})
        assert req.url.startswith(SYNC + "/"), req.url
        headers = {
            "access-control-allow-origin": SITE,
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-headers": "content-type,x-session-id",
        }

        def respond(data, status=200):
            return route.fulfill(json=data, status=status, headers=headers)

        if req.method == "OPTIONS":
            return respond({})
        if path == "/api/health":
            return respond({"ok": True, "mode": "sync"})
        if path in ["/api/rooms", "/api/quests"]:
            return respond(json.loads((ROOT / "data" / (path[5:] + ".json")).read_text()))
        if path == "/api/guestbook":
            return respond({"entries": []})
        if path == "/api/session":
            assert req.post_data_json == {"nickname": "fixture"}
            events.append(("session", 201))
            return respond({"sessionId": "test-sync"}, 201)
        if path == "/api/progress":
            assert req.headers.get("x-session-id") == "test-sync"
            if req.method == "GET":
                return respond({"entries": []})
            assert req.post_data_json == {
                "questId": "quest-gate-tour",
                "evidence": {"roomId": "main-gate"},
            }
            events.append(("progress", 403))
            return respond({"error": "test-denied"}, 403)
        raise AssertionError(req.url)

    page.route("**/*", fixture)
    page.goto(SITE)
    page.wait_for_function(
        "document.querySelector('#hud-mode').textContent.includes('동기화 연결됨')"
    )
    page.locator("#room-list button").first.click()
    assert not events
    page.locator("#auth-anon").click()
    page.wait_for_function("document.querySelector('#auth-status').textContent.includes('실패')")
    assert page.evaluate("localStorage.getItem('inhaworld-firebase-session-v1')") == None
    assert page.locator("#auth-profile-row").is_hidden()
    page.locator("#nickname").fill("fixture")
    page.locator("#save-nickname").click()
    page.wait_for_function(
        "document.querySelector('#status-line').textContent.includes('닉네임 저장됨')"
    )
    page.wait_for_timeout(80)
    assert events == [("firebase", 401), ("session", 201), ("progress", 403)], events
    assert "0/3" in page.locator("#hud-quest").inner_text()
    assert page.evaluate("localStorage.getItem('inha-v01:sync-session')") == "test-sync"
    assert page.evaluate("localStorage.getItem('inha-v01:progress')") == None
    assert not errors
    page.close()
