import { Backdrop } from './backdrop.js'
import { bypass, defaults, material, type Material } from './material.js'
import { box, imageGeometry, overlap, Renderer, type Media } from './renderer.js'
export { defaults, limits, type Material } from './material.js'
export type Source = Media | HTMLElement
export interface Options {
  targets: string | HTMLElement | Iterable<HTMLElement>
  source?: Source | null
  material?: Partial<Material>
  quality?: 'auto' | 'full' | 'balanced' | 'economy'
}
type Mode = 'stopped' | 'waiting' | 'bypass' | 'webgl2' | 'svg' | 'css'
type DrawableContext = CanvasRenderingContext2D & {
  drawElementImage?: (el: HTMLElement, x: number, y: number, w: number, h: number) => void
}
type Saved = Map<string, [string, string]>
const styles = ['position', 'backdrop-filter', '-webkit-backdrop-filter', 'border-radius', 'box-shadow']
function snapshot(el: HTMLElement): Saved {
  return new Map(styles.map((k) => [k, [el.style.getPropertyValue(k), el.style.getPropertyPriority(k)]]))
}
function restore(el: HTMLElement, values: Saved) {
  for (const [k, [v, p]] of values)
    if (v) el.style.setProperty(k, v, p)
    else el.style.removeProperty(k)
}
export class LiquidGlass {
  private m: Material
  private options: Options
  private active = false
  private media: Media | null = null
  private domSource: HTMLElement | null = null
  private paintContext: DrawableContext | null = null
  private gpu: Renderer | null = null
  private lite: Backdrop | null = null
  private abort: AbortController | null = null
  private ro: ResizeObserver | null = null
  private io: IntersectionObserver | null = null
  private mo: MutationObserver | null = null
  private panels = new Map<HTMLElement, Saved>()
  private visible = new Set<HTMLElement>()
  private raf = 0
  private videoTicket: number | null = null
  private dirty = true
  private layout = true
  private rectangles = new Map<HTMLElement, DOMRectReadOnly>()
  private geometry: ReturnType<typeof imageGeometry> | null = null
  private mode: Mode = 'stopped'
  private reason = ''
  private failed = false
  private tier = 0
  private expensive = 0
  private cheap = 0
  private lastFrame = 0
  private totals = { frames: 0, uploads: 0, blurPasses: 0 }
  constructor(options: Options) {
    this.options = { ...options }
    this.m = material(options.material ?? {})
  }
  get settings() {
    return { ...this.m }
  }
  get status() {
    const g = this.gpu
    return {
      mode: this.mode,
      reason: this.reason,
      quality: ['full', 'balanced', 'economy'][this.tier],
      fpsLimit: this.tier === 2 ? 30 : null,
      frames: this.totals.frames + (g?.frames ?? 0),
      uploads: this.totals.uploads + (g?.uploads ?? 0),
      blurPasses: this.totals.blurPasses + (g?.blurPasses ?? 0),
      gpuMs: g?.gpuMs ?? null,
    }
  }
  update(patch: Partial<Material>) {
    this.m = material(patch, this.m)
    this.request()
    return this
  }
  reset(key?: keyof Material) {
    this.m = key ? material({ [key]: defaults[key] }, this.m) : { ...defaults }
    this.request()
    return this
  }
  invalidate = () => {
    this.dirty = true
    this.request()
  }
  private geometryChanged = () => {
    this.layout = true
    this.request()
  }
  refresh = () => {
    if (this.active) this.sync()
  }
  private request = () => {
    if (this.active && !document.hidden && !this.raf) this.raf = requestAnimationFrame(this.render)
  }
  start() {
    if (this.active) return this
    this.active = true
    this.abort = new AbortController()
    const options = { signal: this.abort.signal }
    this.mode = 'waiting'
    this.reason = ''
    this.failed = false
    this.dirty = this.layout = true
    this.tier = this.options.quality === 'economy' ? 2 : this.options.quality === 'balanced' ? 1 : 0
    this.cheap = this.expensive = this.lastFrame = 0
    this.ro = new ResizeObserver(this.geometryChanged)
    this.io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        if (entry.isIntersecting) this.visible.add(el)
        else this.visible.delete(el)
      }
      this.geometryChanged()
    })
    if (typeof this.options.targets === 'string') {
      this.mo = new MutationObserver((records) => {
        const relevant = records.some((r) =>
          [...r.addedNodes, ...r.removedNodes].some(
            (n) => n instanceof HTMLElement && !n.hasAttribute('data-lg-surface'),
          ),
        )
        if (relevant) this.sync()
      })
      this.mo.observe(document.body, { subtree: true, childList: true })
    }
    window.addEventListener('resize', this.geometryChanged, options)
    document.addEventListener('scroll', this.geometryChanged, {
      ...options,
      capture: true,
      passive: true,
    })
    window.visualViewport?.addEventListener('resize', this.geometryChanged, options)
    const watchDpr = () => {
      matchMedia('(resolution: ' + devicePixelRatio + 'dppx)').addEventListener(
        'change',
        () => {
          this.refresh()
          watchDpr()
        },
        { ...options, once: true },
      )
    }
    watchDpr()
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          cancelAnimationFrame(this.raf)
          this.raf = 0
          this.stopVideo()
        } else {
          if (this.domSource)
            (this.media as HTMLCanvasElement & { requestPaint?(): void }).requestPaint?.()
          this.refresh()
        }
      },
      options,
    )
    const src = this.options.source
    if (
      src instanceof HTMLImageElement ||
      src instanceof HTMLVideoElement ||
      src instanceof HTMLCanvasElement
    )
      this.media = src
    else if (src) {
      const host = src.parentElement
      if (
        host instanceof HTMLCanvasElement &&
        host.getAttribute('content') === 'drawable' &&
        src.hasAttribute('drawable')
      ) {
        const ctx = host.getContext('2d') as DrawableContext | null
        if (ctx?.drawElementImage) {
          this.media = host
          this.domSource = src
          this.paintContext = ctx
          host.addEventListener('paint', this.paint, options)
          ;(host as HTMLCanvasElement & { requestPaint?(): void }).requestPaint?.()
        }
      }
      if (!this.media)
        this.reason = 'This HTML background needs a drawable canvas and drawElementImage support'
    }
    if (this.media) {
      this.ro.observe(this.media)
      for (const e of ['load', 'loadeddata', 'seeked', 'play', 'pause', 'emptied', 'resize', 'error'])
        this.media.addEventListener(e, this.mediaChanged, options)
    }
    this.sync()
    return this
  }
  private paint = () => {
    if (
      !this.active ||
      document.hidden ||
      !this.domSource ||
      !this.paintContext ||
      !(this.media instanceof HTMLCanvasElement)
    )
      return
    try {
      this.paintContext.clearRect(0, 0, this.media.width, this.media.height)
      this.paintContext.drawElementImage!(this.domSource, 0, 0, this.media.width, this.media.height)
      this.invalidate()
    } catch (e) {
      this.fail(e)
      this.request()
    }
  }
  private mediaChanged = () => {
    if (this.media instanceof HTMLVideoElement && this.media.paused) this.stopVideo()
    this.retry()
  }
  private sync() {
    const t = this.options.targets
    const next = new Set(
      typeof t === 'string'
        ? document.querySelectorAll<HTMLElement>(t)
        : t instanceof HTMLElement
          ? [t]
          : t,
    )
    for (const [el, saved] of this.panels)
      if (!next.has(el)) {
        restore(el, saved)
        this.ro?.unobserve(el)
        this.io?.unobserve(el)
        this.panels.delete(el)
        this.visible.delete(el)
      }
    for (const el of next)
      if (!this.panels.has(el)) {
        this.panels.set(el, snapshot(el))
        this.ro?.observe(el)
        this.io?.observe(el)
        if (this.gpu && getComputedStyle(el).position === 'static') el.style.position = 'relative'
        const r = el.getBoundingClientRect()
        if (r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)
          this.visible.add(el)
      }
    this.geometryChanged()
  }
  private stopVideo() {
    const v = this.media
    if (v instanceof HTMLVideoElement && this.videoTicket !== null)
      v.cancelVideoFrameCallback?.(this.videoTicket)
    this.videoTicket = null
  }
  private trackVideo() {
    const v = this.media
    if (!(v instanceof HTMLVideoElement) || v.paused || v.ended || this.videoTicket !== null) return
    if (v.requestVideoFrameCallback)
      this.videoTicket = v.requestVideoFrameCallback(() => {
        this.videoTicket = null
        this.invalidate()
      })
    else this.invalidate()
  }
  private release() {
    if (this.gpu) {
      for (const k of ['frames', 'uploads', 'blurPasses'] as const) this.totals[k] += this.gpu[k]
      this.gpu.dispose()
      this.gpu = null
    }
  }
  private fail(e: unknown) {
    this.reason = e instanceof Error ? e.message : String(e)
    this.failed = true
    this.release()
  }
  private clearLite() {
    if (!this.lite) return
    this.lite.dispose()
    this.lite = null
    for (const [el, saved] of this.panels) restore(el, saved)
  }
  private render = (time: number) => {
    this.raf = 0
    if (!this.active || document.hidden) return
    if (this.layout) {
      this.rectangles.clear()
      for (const el of this.visible) {
        const r = el.getBoundingClientRect()
        if (
          r.width &&
          r.height &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < innerHeight &&
          r.left < innerWidth
        )
          this.rectangles.set(el, r)
      }
      this.geometry = this.media ? imageGeometry(this.media) : null
      this.layout = false
    }
    if (!this.rectangles.size || bypass(this.m)) {
      this.stopVideo()
      if (bypass(this.m)) {
        this.release()
        this.clearLite()
        for (const [el, saved] of this.panels) restore(el, saved)
        this.mode = 'bypass'
      } else {
        if (this.gpu) this.gpu.canvas.hidden = true
        this.mode = 'waiting'
      }
      return
    }
    const source = this.media,
      geo = this.geometry
    if (
      source &&
      !this.failed &&
      geo &&
      geo.width &&
      geo.height &&
      !(source instanceof HTMLVideoElement && source.readyState < 2)
    ) {
      try {
        this.clearLite()
        if (!this.gpu) {
          this.gpu = new Renderer(source)
          const renderer = this.gpu
          renderer.canvas.addEventListener(
            'webglcontextlost',
            (e) => {
              e.preventDefault()
              if (this.gpu !== renderer) return
              this.reason = 'WebGL context lost'
              this.failed = true
              renderer.canvas.hidden = true
              this.request()
            },
            { signal: this.abort!.signal },
          )
          renderer.canvas.addEventListener(
            'webglcontextrestored',
            () => {
              if (this.gpu === renderer) this.retry()
            },
            { once: true, signal: this.abort!.signal },
          )
          for (const el of this.panels.keys())
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
          this.dirty = true
        }
        if (this.tier === 2 && this.dirty && time - this.lastFrame < 32 && this.lastFrame) {
          this.request()
          return
        }
        const begin = performance.now()
        const viewport = overlap(geo.clip, { x: 0, y: 0, w: innerWidth, h: innerHeight })
        const panels = [...this.rectangles.values()].map(box).filter((r) => {
          const common = overlap(r, viewport)
          return common.w > 0 && common.h > 0
        })
        if (!panels.length) {
          this.gpu.canvas.hidden = true
          this.stopVideo()
          this.mode = 'waiting'
          return
        }
        this.gpu.render(source, geo, panels, this.m, this.dirty, this.tier)
        this.reason = ''
        this.mode = 'webgl2'
        this.dirty = false
        this.lastFrame = time
        if (this.options.quality === undefined || this.options.quality === 'auto') {
          const cost = Math.max(performance.now() - begin, this.gpu.gpuMs ?? 0)
          this.expensive = cost > 5 ? this.expensive + 1 : 0
          this.cheap = cost < 2 ? this.cheap + 1 : 0
          if (this.expensive >= 6 || this.cheap >= 120) {
            this.tier = Math.max(0, Math.min(2, this.tier + (this.expensive >= 6 ? 1 : -1)))
            this.cheap = this.expensive = 0
          }
        }
        this.trackVideo()
        return
      } catch (e) {
        this.fail(e)
      }
    }
    if (this.gpu) this.gpu.canvas.hidden = true
    if (!this.reason)
      this.reason = source ? 'Waiting for a readable background' : 'No explicit background'
    this.stopVideo()
    this.lite ??= new Backdrop()
    this.lite.apply(this.rectangles, this.m)
    this.mode = this.lite.mode
  }
  retry() {
    if (this.failed) this.release()
    this.failed = false
    this.dirty = true
    this.refresh()
    return this
  }
  stop() {
    this.active = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.stopVideo()
    this.abort?.abort()
    this.ro?.disconnect()
    this.io?.disconnect()
    this.mo?.disconnect()
    this.release()
    this.clearLite()
    for (const [el, saved] of this.panels) restore(el, saved)
    this.panels.clear()
    this.visible.clear()
    this.rectangles.clear()
    this.media = null
    this.domSource = null
    this.paintContext = null
    this.mode = 'stopped'
    return this
  }
}
