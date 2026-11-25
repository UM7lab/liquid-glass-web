"""Create deterministic opaque source PNGs and composite native premultiplied output."""

import argparse
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
out = root / "docs" / "fixtures"
out.mkdir(parents=True, exist_ok=True)
y, x = np.mgrid[:280, :480]
grid = np.where(((x // 28 + y // 28) % 2)[:, :, None], (49, 83, 90), (98, 121, 124))
grid[(x % 28 < 3) | (y % 28 < 3)] = (228, 232, 207)
two = np.where((x < 240)[:, :, None], (47, 199, 211), (215, 71, 135)).astype("uint8")
two[(x % 40 < 2) | (y % 40 < 2)] //= 2
scenes = {
    "grid": grid,
    "colors": two,
    "white": np.full_like(grid, 249),
    "dark": np.full_like(grid, 12),
}
parser = argparse.ArgumentParser()
parser.add_argument("--native", type=Path)
args = parser.parse_args()
for name, data in scenes.items():
    source = Image.fromarray(data.astype("uint8")).convert("RGBA")
    source.save(out / (name + ".png"))
    if args.native:
        temp = root / ".local"
        temp.mkdir(exist_ok=True)
        inp = temp / "input.bgra"
        raw = temp / "native.bgra"
        inp.write_bytes(source.tobytes("raw", "BGRA"))
        subprocess.run([args.native, inp, raw], check=True)
        overlay = Image.frombytes(
            "RGBa", source.size, raw.read_bytes(), "raw", "BGRa"
        ).convert("RGBA")
        Image.alpha_composite(source, overlay).convert("RGB").save(
            out / (name + "-native.png")
        )
