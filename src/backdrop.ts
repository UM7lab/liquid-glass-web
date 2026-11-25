import { bypass, slope, smoother, type Material } from './material.js'
const ns = 'http://www.w3.org/2000/svg'
let nextId = 0
function svg(name: string, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(ns, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}
export function supportsBackdropDisplacement() {
  // A CSS syntax check alone also succeeds on engines that ignore reference filters here.
  return /Chrom(e|ium)\//.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'url("#glass")')
}
function displacement(w: number, h: number, m: Material) {
  const scale = Math.min(0.75, 768 / Math.max(w, h)),
    mw = Math.max(1, Math.ceil(w * scale)),
    mh = Math.max(1, Math.ceil(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = mw
  canvas.height = mh
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(mw, mh),
    reach = Math.min(m.radius * 1.419747773, w / 2, h / 2),
    bevel = Math.min(m.bevel, Math.min(w, h) * 0.24)
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      const px = ((x + 0.5) * w) / mw - w / 2,
        py = ((y + 0.5) * h) / mh - h / 2
      const qx = Math.abs(px) - w / 2 + reach,
        qy = Math.abs(py) - h / 2 + reach
      const ax = Math.max(0, qx),
        ay = Math.max(0, qy),
        norm = Math.cbrt(ax ** 3 + ay ** 3)
      const gx = norm > 0 ? (ax * ax) / (norm * norm) : Number(qx > qy),
        gy = norm > 0 ? (ay * ay) / (norm * norm) : Number(qy >= qx)
      const len = Math.hypot(gx, gy) || 1,
        d = (norm + Math.min(Math.max(qx, qy), 0) - reach) / Math.max(0.5, len)
      const bend = 1 - smoother(-d / Math.max(1, bevel)),
        z = Math.sqrt(Math.max(0.0025, 1 - bend * bend)),
        nl = Math.hypot(bend, z)
      const strength = (bend / nl) * slope(z / nl, m.ior)
      const i = (y * mw + x) * 4
      image.data[i] = Math.round(127.5 + (127.5 * strength * gx * Math.sign(px)) / len)
      image.data[i + 1] = Math.round(127.5 + (127.5 * strength * gy * Math.sign(py)) / len)
      image.data[i + 3] = 255
    }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL()
}
export class Backdrop {
  readonly mode = supportsBackdropDisplacement() ? 'svg' : 'css'
  private root = svg('svg', { 'aria-hidden': 'true', width: 0, height: 0 })
  private filters = new Map<string, { id: string; node: Element }>()
  private maps = new Map<string, string>()
  constructor() {
    this.root.setAttribute('style', 'position:absolute;pointer-events:none')
    document.body.append(this.root)
  }
  apply(entries: Map<HTMLElement, DOMRectReadOnly>, m: Material) {
    const used = new Set<string>()
    for (const [el, rect] of entries) {
      const w = Math.round(rect.width),
        h = Math.round(rect.height),
        opacity = 1 - m.transparency
      let filter = 'none'
      const filtering =
        (m.protection && m.compression > 0) ||
        (opacity > 0 && (m.blurRadius > 0 || (m.refraction > 0 && m.ior > 1)))
      if (w > 0 && h > 0 && filtering && !bypass(m)) {
        if (this.mode === 'svg') {
          const key = [
            w,
            h,
            m.radius,
            m.bevel,
            m.ior,
            m.refraction,
            m.blurRadius,
            opacity,
            m.protection,
            m.compression,
          ].join(',')
          let def = this.filters.get(key)
          if (!def) {
            const id = 'lgw-' + ++nextId
            const node = svg('filter', {
              id,
              x: 0,
              y: 0,
              width: w,
              height: h,
              filterUnits: 'userSpaceOnUse',
              'color-interpolation-filters': 'sRGB',
            })
            let input = 'SourceGraphic'
            if (m.blurRadius > 0 && opacity > 0 && opacity < 1) {
              node.append(
                svg('feGaussianBlur', {
                  in: input,
                  stdDeviation: m.blurRadius / 3,
                  edgeMode: 'duplicate',
                  result: 'soft',
                }),
              )
              input = 'soft'
            }
            if (m.ior > 1 && m.refraction > 0 && opacity > 0) {
              const mapKey = [w, h, m.radius, m.bevel, m.ior].join(',')
              let url = this.maps.get(mapKey)
              if (!url) {
                url = displacement(w, h, m)
                this.maps.set(mapKey, url)
                if (this.maps.size > 32) this.maps.delete(this.maps.keys().next().value!)
              }
              node.append(
                svg('feImage', {
                  href: url,
                  width: w,
                  height: h,
                  preserveAspectRatio: 'none',
                  result: 'field',
                }),
              )
              node.append(
                svg('feDisplacementMap', {
                  in: input,
                  in2: 'field',
                  xChannelSelector: 'R',
                  yChannelSelector: 'G',
                  scale: 2 * m.refraction,
                  result: 'glass',
                }),
              )
              input = 'glass'
            }
            if (opacity > 0 && opacity < 1 && input !== 'SourceGraphic') {
              node.append(
                svg('feComposite', {
                  in: input,
                  in2: 'SourceGraphic',
                  operator: 'arithmetic',
                  k2: opacity,
                  k3: 1 - opacity,
                  result: 'mixed',
                }),
              )
              input = 'mixed'
            }
            if (m.protection && m.compression > 0) {
              const transfer = svg('feComponentTransfer', { in: input })
              // Bake both transfer functions into the LUT so the browser can keep the backdrop in sRGB.
              const curve = Array.from({ length: 129 }, (_, i) => {
                const s = i / 128,
                  y = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4,
                  x = Math.max(0, y - 0.06)
                const mapped = Math.min(y, 0.06) + x / (1 + 20 * m.compression * x)
                return mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055
              }).join(' ')
              for (const channel of ['R', 'G', 'B'])
                transfer.append(svg('feFunc' + channel, { type: 'table', tableValues: curve }))
              node.append(transfer)
            }
            this.root.append(node)
            def = { id, node }
            this.filters.set(key, def)
          }
          used.add(key)
          const blur = opacity === 1 && m.blurRadius > 0 ? 'blur(' + m.blurRadius / 3 + 'px) ' : ''
          filter = blur + 'url("#' + def.id + '")'
        } else {
          const sigma = (m.blurRadius / 3) * opacity
          const brightness = m.protection ? 1 - 0.46 * m.compression : 1
          filter = 'blur(' + sigma + 'px) brightness(' + brightness + ')'
        }
      }
      el.style.setProperty('backdrop-filter', filter)
      el.style.setProperty('-webkit-backdrop-filter', filter)
      el.style.borderRadius = m.radius + 'px'
      const shadow = m.shadow && opacity > 0 ? '0 1px 4px rgb(0 0 0 / ' + 0.08 * opacity + ')' : ''
      const rim =
        m.highlight > 0 && opacity > 0
          ? 'inset 0 0 0 1px rgb(255 255 255 / ' + m.highlight * opacity + ')'
          : ''
      el.style.boxShadow = [shadow, rim].filter(Boolean).join(',') || 'none'
    }
    for (const [key, v] of this.filters)
      if (!used.has(key)) {
        v.node.remove()
        this.filters.delete(key)
      }
  }
  dispose() {
    this.root.remove()
    this.maps.clear()
    this.filters.clear()
  }
}
