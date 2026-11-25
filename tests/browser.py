"""Run with python tests/browser.py --chrome /path/to/chrome."""

import argparse, json, io
import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from server import serve, ROOT

parser = argparse.ArgumentParser()
parser.add_argument("--chrome")
args = parser.parse_args()
server, url = serve()
out = ROOT / "docs" / "fixtures"


def status(page):
    return page.evaluate("glass.status")


def settle(p):
    p.evaluate(
        "()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))"
    )


def shot(p):
    return Image.open(io.BytesIO(p.locator("#stage").screenshot())).convert("RGB")


def fixture(p, query=""):
    p.goto(url + "/tests/fixture.html?" + query)
    p.wait_for_function("window.ready")
    settle(p)


results = {}
with sync_playwright() as pw:
    browser = pw.chromium.launch(
        executable_path=args.chrome,
        headless=True,
        args=["--enable-gpu", "--use-angle=d3d11"] if args.chrome else ["--enable-gpu"],
    )
    p = browser.new_page(viewport={"width": 640, "height": 480}, device_scale_factor=1)
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    for scene in ["grid", "colors", "white", "dark"]:
        fixture(p, "scene=" + scene)
        assert status(p)["mode"] == "webgl2", status(p)
        web = shot(p)
        web.save(out / (scene + "-web.png"))
        native = Image.open(out / (scene + "-native.png")).convert("RGB")
        delta = np.abs(np.asarray(web).astype(float) - np.asarray(native))
        rim = delta[40:240, 32:40]
        results[scene] = {
            "mean": round(float(delta.mean()), 3),
            "p99": float(np.percentile(delta, 99)),
            "straight_edge_mean": round(float(rim.mean()), 3),
        }
        assert delta.mean() < 3 and np.percentile(delta, 99) < 14, (
            scene,
            results[scene],
        )
    fixture(p)
    original = Image.open(out / "grid.png").convert("RGB")
    p.evaluate("glass.update({transparency:1,protection:false});void 0")
    settle(p)
    assert status(p)["mode"] == "bypass" and np.array_equal(shot(p), original)
    p.evaluate(
        "glass.update({transparency:0,protection:false,blurRadius:0,ior:1,highlight:0,innerContour:0,environmentStrength:0,shadow:false});void 0"
    )
    settle(p)
    assert np.abs(np.asarray(shot(p)).astype(float) - np.asarray(original)).max() <= 2
    p.evaluate("glass.update({ior:1.5168});void 0")
    settle(p)
    bent = np.asarray(shot(p))
    clear = np.asarray(original)
    assert np.array_equal(bent[95:185, 120:360], clear[95:185, 120:360]) and np.any(
        bent[65:215, 32:48] != clear[65:215, 32:48]
    )
    p.evaluate("glass.reset();void 0")
    settle(p)
    start = status(p)
    p.wait_for_timeout(10000)
    assert [start[k] for k in ["frames", "uploads"]] == [
        status(p)[k] for k in ["frames", "uploads"]
    ]
    p.evaluate("glass.stop();glass.start();void 0")
    settle(p)
    assert p.locator("[data-lg-surface]").count() == 1
    p.evaluate(
        "document.querySelector('[data-lg-surface]').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()"
    )
    p.wait_for_function("['css','svg'].includes(glass.status.mode)")
    p.evaluate("glass.retry();void 0")
    settle(p)
    assert status(p)["mode"] == "webgl2", status(p)
    for size, dpr in [
        ({"width": 390, "height": 844}, 3),
        ({"width": 800, "height": 550}, 2),
    ]:
        mob = browser.new_page(
            viewport=size, device_scale_factor=dpr, is_mobile=dpr == 3
        )
        fixture(mob)
        assert status(mob)["mode"] == "webgl2"
        mob.close()
    fixture(p, "mode=svg")
    assert status(p)["mode"] in ("css", "svg")
    assert np.abs(np.asarray(shot(p)).astype(float) - np.asarray(original)).mean() > 2
    if status(p)["mode"] == "svg":
        p.evaluate(
            "glass.update({ior:1, blurRadius:0, protection:false, highlight:0, shadow:false});void 0"
        )
        settle(p)
        plain = np.asarray(shot(p))
        p.evaluate("glass.update({ior:1.8,refraction:12});void 0")
        settle(p)
        displaced = np.asarray(shot(p))
        assert np.any(displaced[65:215, 32:48] != plain[65:215, 32:48]), (
            "SVG edge displacement missing"
        )
    p.goto(url + "/demo/")
    p.locator("#status").filter(has_text="webgl2").wait_for(timeout=10000)
    p.set_viewport_size({"width": 1360, "height": 850})
    settle(p)
    p.screenshot(path=ROOT / "docs" / "showcase.png")
    assert not errors, errors
    results["browser"] = browser.version
    browser.close()
server.shutdown()
(out / "comparison.json").write_text(
    json.dumps(results, indent=2) + "\n", encoding="utf8"
)
a = Image.open(out / "colors-native.png")
b = Image.open(out / "colors-web.png")
sheet = Image.new("RGB", (960, 396), "#f4f3ed")
draw = ImageDraw.Draw(sheet)
for i, (im, label) in enumerate([(a, "Windows 3.2"), (b, "WebGL 2")]):
    sheet.paste(im, (480 * i, 24))
    draw.text((480 * i + 10, 5), label, fill="#202520")
    sheet.paste(
        im.crop((18, 55, 134, 78)).resize((464, 92), Image.Resampling.NEAREST),
        (480 * i + 8, 304),
    )
sheet.save(out / "comparison.png")
print(json.dumps(results))
