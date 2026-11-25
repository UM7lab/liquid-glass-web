// src/react.ts
import { useEffect, useRef } from "react";
import { LiquidGlass } from "./index.js";

// src/material.ts
var defaults = Object.freeze({
  ior: 1.5168,
  transparency: 0,
  blurRadius: 18,
  refraction: 6,
  radius: 56,
  bevel: 16,
  highlight: 0.12,
  innerContour: 0.03,
  bodyLens: 0,
  environmentStrength: 0.35,
  environmentRadius: 24,
  compression: 0.5,
  protection: true,
  shadow: true,
  contour: "environment"
});
var limits = {
  ior: [1, 2],
  transparency: [0, 1],
  blurRadius: [0, 24],
  refraction: [0, 64],
  radius: [0, 256],
  bevel: [8, 48],
  highlight: [0, 0.4],
  innerContour: [0, 0.2],
  bodyLens: [0, 0.05],
  environmentStrength: [0, 1],
  environmentRadius: [0, 64],
  compression: [0, 1]
};
function material(patch, current = { ...defaults }) {
  const next = { ...current };
  for (const key of Object.keys(limits)) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const [min, max] = limits[key];
      next[key] = Math.min(max, Math.max(min, value));
    }
  }
  for (const key of ["protection", "shadow"])
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  if (patch.contour === "white" || patch.contour === "environment") next.contour = patch.contour;
  return next;
}

// src/react.ts
var groups = /* @__PURE__ */ new Set();
function detach(group, el) {
  group.targets.delete(el);
  if (group.targets.size) group.engine.refresh();
  else {
    group.engine.stop();
    groups.delete(group);
  }
}
function useLiquidGlass(options = {}) {
  const ref = useRef(null), attached = useRef(null);
  const source = options.source ?? null, quality = options.quality ?? "auto";
  const settings = material(options.material ?? {}), key = JSON.stringify(settings);
  useEffect(() => {
    const el = ref.current, previous = attached.current;
    if (!el) {
      if (previous) detach(previous.group, previous.el);
      attached.current = null;
      return;
    }
    let group = [...groups].find((g) => g.source === source && g.quality === quality && g.key === key);
    if (previous && previous.group === group && previous.el === el) return;
    if (previous && !group && previous.group.targets.size === 1 && previous.group.source === source && previous.group.quality === quality && previous.el === el) {
      previous.group.key = key;
      previous.group.engine.update(settings);
      return;
    }
    if (previous) detach(previous.group, previous.el);
    if (!group) {
      const targets = /* @__PURE__ */ new Set([el]);
      group = {
        source,
        quality,
        key,
        targets,
        engine: new LiquidGlass({ targets, source, quality, material: settings }).start()
      };
      groups.add(group);
    } else {
      group.targets.add(el);
      group.engine.refresh();
    }
    attached.current = { group, el };
  });
  useEffect(
    () => () => {
      if (attached.current) detach(attached.current.group, attached.current.el);
      attached.current = null;
    },
    []
  );
  return ref;
}
export {
  useLiquidGlass
};
