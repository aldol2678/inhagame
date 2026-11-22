"""Collide via the normal PC input handlers, turn in place, then back away."""

import json
import math
from test_world import ROOT, OUT, Driver, guest_ready, hold, frame, position, screenshot, draw_stats


def test_walls_camera_and_repeated_visits(origin, browser):
    layout = json.loads((ROOT / "data/layout.json").read_text())
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.add_init_script(path=ROOT / "tests/world-driver.js")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def local(r):
        if r.request.url == origin + "/api/health":
            return r.fulfill(status=503, json={})
        assert r.request.url.startswith(origin + "/") and r.request.method == "GET"
        return r.continue_()

    page.route("**/*", local)
    page.goto(origin)
    guest_ready(page)
    hold(page)
    cdp = page.context.new_cdp_session(page)
    ctl = Driver(page, cdp, False)

    def check_contact(start, id):
        ring = next(o["polygon"] for o in layout["obstacles"] if o["id"] == id)
        cx = sum(p["x"] for p in ring) / len(ring)
        cz = sum(p["z"] for p in ring) / len(ring)
        # Aim through the obstacle. Verify the actual end belongs to its outer edge.
        dx = cx - start[0]
        dz = cz - start[1]
        d = math.hypot(dx, dz)
        ctl.walk({"x": cx + dx / d * 2, "z": cz + dz / d * 2}, collision=True)
        x, z = position(page)

        def segment(a, b):
            dx, dz = b["x"] - a["x"], b["z"] - a["z"]
            t = max(0, min(1, ((x - a["x"]) * dx + (z - a["z"]) * dz) / (dx * dx + dz * dz)))
            return math.hypot(x - a["x"] - t * dx, z - a["z"] - t * dz)

        gap = min(segment(a, ring[(i + 1) % len(ring)]) for i, a in enumerate(ring))
        assert 0.53 < gap < 0.69, (id, gap)
        for _ in range(4):
            ctl.face(ctl.yaw + math.pi / 2)
            frame(page, 1, 0.02)
            assert position(page) == (x, z)
        ctl.walk({"x": start[0], "z": start[1]})
        return {"id": id, "edgeGapWU": round(gap, 3), "contact": [x, z], "retreat": position(page)}

    contacts = [check_contact(position(page), "gate_wall_1")]
    ctl.walk(layout["rooms"]["main-gate"])
    gate = position(page)
    tree = min(
        (o for o in layout["obstacles"] if o["id"].startswith("tree-")),
        key=lambda o: math.dist(gate, [o["polygon"][0]["x"], o["polygon"][0]["z"]]),
    )
    contacts.append(check_contact(gate, tree["id"]))
    # Create wider context shots looking toward each facade.
    for label, i in [("hall", 1), ("library", 2)]:
        page.evaluate("document.exitPointerLock()")
        page.locator("#room-list button").nth(i).click()
        ctl = Driver(page, cdp, False)
        pos = layout["rooms"][["main-building", "library"][i - 1]]
        ctl.yaw = pos["viewYaw"]
        page.keyboard.down("s")
        frame(page, 32, 0.045)
        page.keyboard.up("s")
        frame(page, 1, 0.016)
        screenshot(page, "04-approach-" + label)
    page.evaluate("document.exitPointerLock()")
    cdp.send("Performance.enable")

    def measurement():
        cdp.send("HeapProfiler.collectGarbage")
        return {
            "heap": next(
                m["value"]
                for m in cdp.send("Performance.getMetrics")["metrics"]
                if m["name"] == "JSHeapUsedSize"
            ),
            "nodes": cdp.send("Memory.getDOMCounters")["nodes"],
            "lost": draw_stats(page)["lost"],
        }

    measurements = []
    for k in range(3):
        for i in [0, 1, 2] * 4:
            page.locator("#room-list button").nth(i).click()
            frame(page, 1, 0.02)
        measurements.append(measurement())
    assert not errors and all(not m["lost"] for m in measurements)
    if OUT:
        (OUT / "contact-memory.json").write_text(
            json.dumps(
                dict(
                    result="PASS",
                    contacts=contacts,
                    visits=36,
                    measurements=measurements,
                    errors=errors,
                ),
                indent=2,
            )
        )
    page.close()


def test_glazed_entry_clearance(origin, browser):
    """The eye stays outside the closed vestibule while the exterior visit still fires."""
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.add_init_script(path=ROOT / "tests/world-driver.js")

    def network(r):
        assert r.request.url.startswith(origin + "/")
        if "/api/" in r.request.url:
            return r.fulfill(status=503, json={})
        return r.continue_()

    page.route("**/*", network)
    page.goto(origin)
    guest_ready(page)
    hold(page)
    layout = json.loads((ROOT / "data/layout.json").read_text())
    room = layout["rooms"]["library"]
    page.locator("#room-list button").nth(2).click()
    ctl = Driver(page, page.context.new_cdp_session(page), False)
    ctl.yaw = room["viewYaw"]
    dx, dz = -math.sin(ctl.yaw), -math.cos(ctl.yaw)
    ctl.walk({"x": room["x"] + dx * 5, "z": room["z"] + dz * 5}, collision=True)
    x, z = position(page)
    traveled = (x - room["x"]) * dx + (z - room["z"]) * dz
    # Landing at v=1.8; glass face v=.745; body radius .6; HUD rounds to .1.
    assert 0.32 < traveled < 0.55, traveled
    assert "중앙도서관" in page.locator("#hud-room").inner_text()
    ctl.walk(room)
    if OUT:
        (OUT / "glazed-entry.json").write_text(
            json.dumps(dict(result="PASS", advanceWU=traveled, inputs=ctl.inputs), indent=2)
        )
    page.close()
