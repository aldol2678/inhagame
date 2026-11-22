"""Complete the bank traversal at the three remaining touch viewport sizes."""

import json
import pytest
from test_world import ROOT, OUT, BANK_LEGS, Driver, guest_ready, hold, routes


@pytest.mark.parametrize("w,h", [(320, 568), (390, 844), (891, 411)])
def test_touch_bank_replay(origin, browser, routes, w, h):
    ctx = browser.new_context(
        viewport={"width": w, "height": h}, is_mobile=True, has_touch=True, device_scale_factor=1
    )
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def local(r):
        if r.request.url == origin + "/api/health":
            return r.fulfill(status=503, json={})
        if r.request.url.startswith(origin + "/") and r.request.method == "GET":
            return r.continue_()
        raise AssertionError(r.request.url)

    page.route("**/*", local)
    page.add_init_script(path=ROOT / "tests/world-driver.js")
    try:
        page.goto(origin)
        guest_ready(page)
        hold(page)
        ctl = Driver(page, ctx.new_cdp_session(page), True)
        for name, back in BANK_LEGS:
            path = routes["legs"][name]
            for target in (path[::-1] if back else path)[1:]:
                ctl.walk(target)
        assert "2/3" in page.locator("#hud-quest").inner_text()
        assert not errors
        if OUT:
            (OUT / f"{w}x{h}-route.json").write_text(
                json.dumps(
                    {
                        "result": "PASS",
                        "input": "CDP-touch",
                        "errors": errors,
                        "inputs": ctl.inputs,
                    },
                    indent=2,
                )
            )
    finally:
        ctx.close()
