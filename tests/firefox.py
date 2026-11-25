"""Smoke-test the CSS page backdrop in Playwright Firefox."""

from io import BytesIO
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright
from server import serve, ROOT

server, url = serve()
with sync_playwright() as pw:
    browser = pw.firefox.launch()
    page = browser.new_page(viewport={"width": 640, "height": 480})
    page.goto(url + "/tests/fixture.html?mode=svg")
    page.wait_for_function("window.ready && glass.status.mode==='css'")
    assert (
        page.evaluate(
            "getComputedStyle(document.querySelector('.panel')).backdropFilter"
        )
        != "none"
    )
    original = Image.open(ROOT / "docs/fixtures/grid.png").convert("RGB")
    rendered = Image.open(BytesIO(page.locator("#stage").screenshot())).convert("RGB")
    assert ImageChops.difference(original, rendered).getbbox()
    page.evaluate("glass.update({transparency:1,protection:false});void 0")
    page.wait_for_function("glass.status.mode==='bypass'")
    page.evaluate("glass.stop();void 0")
    print(
        "Firefox",
        browser.version,
        "CSS backdrop, transparency bypass and cleanup passed",
    )
    browser.close()
server.shutdown()
