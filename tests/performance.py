"""Windows hardware benchmark. Requires pywin32, playwright, numpy and a built Aurora checkout."""

import argparse, json, time
from pathlib import Path
import numpy as np
import win32pdh as pdh
from playwright.sync_api import sync_playwright
from server import ROOT, serve

parser = argparse.ArgumentParser()
parser.add_argument("--chrome", required=True)
parser.add_argument("--baseline", type=Path, required=True)
parser.add_argument("--duration", type=int, default=4000)
parser.add_argument("--repeat", type=int, default=3)
parser.add_argument(
    "--quick", action="store_true", help="Measure one dynamic six-panel pass only"
)
args = parser.parse_args()
server, url = serve(args.baseline)
records = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(
        executable_path=args.chrome,
        headless=True,
        args=["--enable-gpu", "--use-angle=d3d11"],
    )
    session = browser.new_browser_cdp_session()
    system = session.send("SystemInfo.getInfo")["gpu"]
    renderer = system["auxAttributes"].get("glRenderer", "")
    if "swiftshader" in renderer.lower() or "software" in renderer.lower():
        raise RuntimeError(renderer)
    gpu_pid = next(
        row["id"]
        for row in session.send("SystemInfo.getProcessInfo")["processInfo"]
        if row["type"].lower() == "gpu"
    )
    q = pdh.OpenQuery()
    counter = pdh.AddEnglishCounter(q, r"\GPU Engine(*)\Running Time")

    def sample():
        pdh.CollectQueryData(q)
        values = pdh.GetFormattedCounterArray(counter, pdh.PDH_FMT_LARGE)
        return {
            k: v for k, v in values.items() if k.startswith("pid_" + str(gpu_pid) + "_")
        }

    page = browser.new_page(
        viewport={"width": 1280, "height": 720}, device_scale_factor=1
    )
    modes = ["bare", "legacy", "svg", "webgl2"]
    jobs = (
        [(1, "motion", m, False) for m in modes]
        + [(6, "scroll", m, False) for m in modes]
        + [(6, "idle", m, False) for m in modes]
    )
    jobs += [(6, "idle", m, True) for m in ["bare", "legacy"]]
    for trial in range(args.repeat):
        order = modes[trial % 4 :] + modes[: trial % 4]
        jobs.extend((6, "motion", m, False) for m in order)
    if args.quick:
        jobs = [(6, "motion", m, False) for m in modes]
    page.goto(url + "/tests/fixture.html?bench&mode=bare")
    page.wait_for_function("window.ready")
    calibration = page.evaluate("()=>runTrial(1200,'idle')")
    target = float(np.median(np.diff(calibration["timestamps"])))
    for count, scene, mode, ambient in jobs:
        page.goto(
            url
            + f"/tests/fixture.html?bench&mode={mode}&count={count}"
            + ("&ambient" if ambient else "")
        )
        page.wait_for_function("window.ready")
        page.evaluate("(s)=>runTrial(1100,s)", scene)
        before = sample()
        start = time.perf_counter()
        data = page.evaluate("([d,s])=>runTrial(d,s)", [args.duration, scene])
        end = time.perf_counter()
        after = sample()
        active = {k: (v - before.get(k, v)) / 10000 for k, v in after.items()}
        three_d = sum(v for k, v in active.items() if k.lower().endswith("engtype_3d"))
        intervals = np.diff(data["timestamps"])
        missed = int(np.maximum(0, np.rint(intervals / target).astype(int) - 1).sum())
        row = dict(
            panels=count,
            scene=scene,
            mode=mode,
            ambient=ambient,
            actual=data["mode"],
            busy3d_ms_s=round(three_d / (end - start), 2),
            all_engines_ms_s=round(sum(active.values()) / (end - start), 2),
            fps=round(1000 / float(np.mean(intervals)), 2),
            missed=missed,
            slots=len(intervals) + missed,
            source_frames=data["sourceFrames"],
            frame_p95_ms=round(float(np.percentile(intervals, 95)), 2),
            draws=data["draws"],
            uploads=data["uploads"],
            quality=data["tiers"] if mode == "webgl2" else None,
            shader_p95_ms=round(float(np.percentile(data["gpu"], 95)), 3)
            if data["gpu"]
            else None,
        )
        records.append(row)
        print(count, scene, mode, ambient, row["busy3d_ms_s"], row["fps"], flush=True)
    pdh.CloseQuery(q)
    browser.close()
server.shutdown()
report = {
    "renderer": renderer,
    "browser": browser.version,
    "viewport": [1280, 720],
    "dpr": 1,
    "display_interval_ms": round(target, 3),
    "source_hz": 60,
    "duration_ms": args.duration,
    "runs": records,
}
output = ROOT / (".local" if args.quick else "docs") / "performance.json"
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
