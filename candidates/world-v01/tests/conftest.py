import functools
import http.server
import os
import pathlib
import threading

import pytest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def origin():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as tool:
        instance = tool.chromium.launch(
            executable_path=os.getenv("CHROMIUM", "/usr/bin/chromium"),
            args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        yield instance
        instance.close()
