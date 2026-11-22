"""PC/touch Chromium QA. Set WORLD_QA_DIR to retain evidence outside the checkout."""

import json
import math
import os
from pathlib import Path
import statistics
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]

BANK_LEGS = [
    ("spawn-gate", False),
    ("gate-hall", False),
    ("hall-west", False),
    ("west-library", False),
    ("west-library", True),
    ("hall-west", True),
    ("gate-hall", True),
    ("gate-hall", False),
    ("hall-east", False),
    ("east-library", False),
    ("east-library", True),
    ("hall-east", True),
    ("gate-hall", True),
]

CASES = [(1280, 720), (320, 568), (390, 844), (844, 390), (891, 411)]
OUT = Path(os.environ["WORLD_QA_DIR"]) if "WORLD_QA_DIR" in os.environ else None


@pytest.fixture(scope="session")
def routes():
    return json.loads(subprocess.check_output(["node", ROOT / "tests/routes.mjs"]))


def position(page):
    text = page.locator("#hud-pos").text_content()
    x, z = text.replace("x ", "").split(" · z ")
    return (float(x), float(z))


def screenshot(page, name):
    if OUT:
        (OUT / "screens").mkdir(parents=True, exist_ok=True)
        page.screenshot(path=OUT / "screens" / f"{name}.png")


def draw_stats(page):
    return page.evaluate("""() => {
      const gl = document.querySelector('#scene').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {renderer:info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
              lost:gl.isContextLost(), buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight]};
    }""")


def frame(page, count, dt):
    page.evaluate("([n,t])=>worldTest.advance(n,t)", [count, dt])


def touches(cdp, typ, points):
    cdp.send(
        "Input.dispatchTouchEvent",
        dict(
            type=typ, touchPoints=[dict(x=x, y=y, id=i, radiusX=4, radiusY=4) for i, x, y in points]
        ),
    )


class Driver:
    def __init__(self, page, cdp, mobile):
        self.page, self.cdp, self.mobile = page, cdp, mobile
        self.yaw = math.pi
        self.inputs = []
        box = page.locator("#scene").bounding_box()
        self.left = box["x"] + box["width"] * 0.26
        self.cy = box["y"] + box["height"] * 0.5
        self.right = box["x"] + box["width"] * 0.72
        if not mobile:
            page.locator("#scene").click(position={"x": 100, "y": 80})
            page.wait_for_function("document.pointerLockElement===document.querySelector('#scene')")

    def face(self, yaw):
        if self.mobile:
            return
        delta = round(((self.yaw - yaw + math.pi) % (2 * math.pi) - math.pi) / 0.003)
        self.page.evaluate(
            "v=>document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,movementX:v}))",
            delta,
        )
        self.yaw -= delta * 0.003

    def walk(self, target, collision=False):
        page = self.page
        x, z = position(page)
        dx, dz = target["x"] - x, target["z"] - z
        dist = math.hypot(dx, dz)
        if dist < 0.09:
            return
        n = math.ceil(dist / (8 * 0.048))
        if self.mobile:
            fx = (dx * math.cos(self.yaw) - dz * math.sin(self.yaw)) / dist
            fz = (dx * math.sin(self.yaw) + dz * math.cos(self.yaw)) / dist
            touches(self.cdp, "touchStart", [(1, self.left, self.cy)])
            touches(self.cdp, "touchMove", [(1, self.left + fx * 50, self.cy + fz * 50)])
        else:
            self.face(math.atan2(-dx, -dz))
            page.keyboard.down("w")
        frame(page, n, dist / (8 * n))
        if self.mobile:
            touches(self.cdp, "touchEnd", [])
        else:
            page.keyboard.up("w")
        actual = position(page)
        error = math.dist(actual, (target["x"], target["z"]))
        self.inputs.append(
            dict(
                target=[round(target["x"], 3), round(target["z"], 3)],
                actual=actual,
                frames=n,
                error=round(error, 3),
                collision=collision,
            )
        )
        if collision:
            assert error > 1, self.inputs[-1]
        else:
            assert error < 0.38, self.inputs[-1]


def hold(page):
    page.evaluate("worldTest.hold()")
    page.wait_for_function("worldTest.ready()", polling=20)


def guest_ready(page):
    page.wait_for_function(
        "document.querySelector('#room-list').children.length===3 && document.querySelector('#hud-pos').textContent.includes('x ')"
    )


@pytest.mark.parametrize("w,h", CASES)
def test_world(origin, browser, routes, w, h):
    mobile = w < 1000
    name = f"{w}x{h}"
    context = browser.new_context(
        viewport=dict(width=w, height=h), is_mobile=mobile, has_touch=mobile, device_scale_factor=1
    )
    page = context.new_page()
    errors, console, network, external, failed = [], [], [], [], []
    report = dict(
        viewport=[w, h],
        touch=mobile,
        errors=errors,
        console=console,
        http=network,
        failed=failed,
        external=external,
    )
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on(
        "console",
        lambda m: console.append([m.type, m.text]) if m.type in ["warning", "error"] else None,
    )
    page.on(
        "response",
        lambda r: (
            network.append([r.status, r.url.removeprefix(origin)]) if r.status >= 400 else None
        ),
    )
    page.on("requestfailed", lambda r: failed.append([r.url.removeprefix(origin), r.failure]))

    def network_fixture(r):
        if r.request.url.startswith(origin + "/api/"):
            assert r.request.method == "GET"
            return r.fulfill(status=503, json={"error": "offline fixture"})
        if r.request.url.startswith(origin + "/"):
            return r.continue_()
        external.append(r.request.url)
        return r.abort()

    page.route("**/*", network_fixture)
    page.add_init_script(path=ROOT / "tests/world-driver.js")
    page.add_init_script("""if (!sessionStorage.getItem('fixture')) {
      localStorage.setItem('inha-v01:progress',JSON.stringify({'legacy-extra':{status:'done',updatedAt:'2025-01-01'}}));
      sessionStorage.setItem('fixture','1');
    }""")
    cdp = context.new_cdp_session(page)
    cdp.send("Performance.enable")
    try:
        page.goto(origin)
        guest_ready(page)
        page.wait_for_function("worldTest.times().length>=33", timeout=45000)
        times = page.evaluate("worldTest.times()")
        dts = [b - a for a, b in zip(times[-32:-1], times[-31:])]
        dts.sort()

        def heap():
            return next(
                m["value"]
                for m in cdp.send("Performance.getMetrics")["metrics"]
                if m["name"] == "JSHeapUsedSize"
            )

        report.update(
            chromium=browser.version,
            webgl=draw_stats(page),
            frames=len(dts),
            fps=round(1000 / statistics.mean(dts), 1),
            medianMs=round(statistics.median(dts), 1),
            p95Ms=round(dts[math.ceil(len(dts) * 0.95) - 1], 1),
            firstRafMs=round(times[0], 1),
            heapBefore=heap(),
        )
        assert not report["webgl"]["lost"]
        assert page.evaluate("document.documentElement.scrollWidth===innerWidth")
        screenshot(page, "02-" + name + "-spawn")
        hold(page)
        driver = Driver(page, cdp, mobile)
        report["inputs"] = driver.inputs
        # A real two-finger CDP gesture rotates and moves together.
        if mobile:
            lx, rx, y = driver.left, driver.right, driver.cy
            touches(cdp, "touchStart", [(1, lx, y), (2, rx, y)])
            touches(cdp, "touchMove", [(1, lx, y - 42), (2, rx + 42, y)])
            frame(page, 16, 0.045)
            touches(cdp, "touchEnd", [])
            moved = position(page)
            assert abs(moved[0]) > 0.5 and moved[1] > -96, moved
            assert page.locator("#joy-base").is_hidden()
        else:
            page.mouse.move(260, 200)
            page.mouse.move(340, 200)
            page.keyboard.down("w")
            frame(page, 8, 0.04)
            page.keyboard.up("w")
            assert abs(position(page)[0]) > 0.12, position(page)
            page.keyboard.down("s")
            frame(page, 8, 0.04)
            page.keyboard.up("s")
            for key in ("a", "d", "s", "w"):
                old = position(page)
                page.keyboard.down(key)
                frame(page, 6, 0.04)
                page.keyboard.up(key)
                assert math.dist(old, position(page)) > 1
            assert position(page) == (0.0, -98.0)
            page.evaluate("document.exitPointerLock()")
        page.reload()
        guest_ready(page)
        hold(page)
        driver = Driver(page, cdp, mobile)
        report["inputs"] = driver.inputs
        # Exercise the complete route on both desktop and narrow landscape.
        if w in [1280, 844]:
            legs = routes["legs"]
            for key, reverse in BANK_LEGS:
                path = legs[key][::-1] if reverse else legs[key]
                for target in path[1:]:
                    driver.walk(target)
                stop = key.split("-")[0 if reverse else 1]
                if not reverse and not mobile:
                    if stop in routes["waypoints"] and "viewYaw" in routes["waypoints"][stop]:
                        driver.face(routes["waypoints"][stop]["viewYaw"])
                    elif stop in ("west", "east"):
                        other = routes["waypoints"]["east" if stop == "west" else "west"]
                        here = routes["waypoints"][stop]
                        driver.face(math.atan2(here["x"] - other["x"], here["z"] - other["z"]))
                    frame(page, 1, 0.016)
                    screenshot(page, "03-after-" + stop)
            assert "2/3" in page.locator("#hud-quest").inner_text()
            report["traversal"] = "both banks forward and reverse"
            # Walk from the west approach into the reflecting pool.
            for leg in ["gate-hall", "hall-west"]:
                for target in legs[leg][1:]:
                    driver.walk(target)
            west, east = routes["waypoints"]["west"], routes["waypoints"]["east"]
            driver.walk(
                dict(x=(west["x"] + east["x"]) / 2, z=(west["z"] + east["z"]) / 2), collision=True
            )
            # Back out, then approach the library facade using its room button.
            driver.walk(west)
        else:
            driver.walk(routes["waypoints"]["gate"])
            assert "1/3" in page.locator("#hud-quest").inner_text()
            report["traversal"] = "spawn to gate"
        if not mobile:
            page.evaluate("document.exitPointerLock()")
        page.locator("#room-list button").nth(2).click()
        if mobile:
            page.evaluate("scrollTo(0,0)")
        driver = Driver(page, cdp, mobile)
        driver.yaw = routes["waypoints"]["library"]["viewYaw"]
        pos = routes["waypoints"]["library"]
        dx, dz = -math.sin(driver.yaw), -math.cos(driver.yaw)
        driver.walk({"x": pos["x"] + dx * 5, "z": pos["z"] + dz * 5}, collision=True)
        driver.walk(pos)
        report["facadeAndRetreat"] = driver.inputs
        if not mobile:
            page.evaluate("document.exitPointerLock()")
        page.locator("#nickname").fill("QA-캠퍼스")
        page.locator("#save-nickname").click()
        page.locator("#room-list button").nth(1).click()
        page.locator("#guest-message").fill("격리 픽스처")
        page.locator("#guest-submit").click()
        page.locator("#quest-list button").filter(has_text="방명록").click()
        page.wait_for_function("document.querySelector('#hud-quest').textContent.includes('3/3')")
        storage = page.evaluate(
            "Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage[k]]))"
        )
        assert json.loads(storage["inha-v01:progress"])["legacy-extra"]["updatedAt"] == "2025-01-01"
        page.reload()
        guest_ready(page)
        assert page.locator("#nickname").input_value() == "QA-캠퍼스"
        assert "3/3" in page.locator("#hud-quest").inner_text()
        page.locator("#guest-room").select_option("main-building")
        page.wait_for_function(
            "document.querySelector('#guestbook-list').textContent.includes('격리 픽스처')"
        )
        assert storage == page.evaluate(
            "Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage[k]]))"
        )
        report["restoredKeys"] = sorted(storage.keys())
        if mobile:
            page.set_viewport_size(dict(width=h, height=w))
            page.evaluate("scrollTo(0,0)")
            page.wait_for_function(
                'document.querySelector("#scene").width===document.querySelector("#scene").clientWidth'
            )
            assert page.evaluate("document.documentElement.scrollWidth===innerWidth")
            report["rotatedBuffer"] = draw_stats(page)["buffer"]
        report["heapAfter"] = heap()
        assert not errors, errors
        assert all(url.startswith("https://www.gstatic.com/firebasejs/") for url in external), (
            external
        )
        assert all(status == 503 and url == "/api/health" for status, url in network), network
        assert all(url.startswith("https://www.gstatic.com/firebasejs/") for url, _ in failed), (
            failed
        )
        report["result"] = "PASS"
    finally:
        if OUT:
            OUT.mkdir(exist_ok=True, parents=True)
            (OUT / f"{name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        context.close()
