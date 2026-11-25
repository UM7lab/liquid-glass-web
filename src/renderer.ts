import { blurShader, glassShader, vertex } from './shaders.js'
import type { Material } from './material.js'
export type Media = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
export type Box = { x: number; y: number; w: number; h: number }
export const box = (r: DOMRectReadOnly): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height })
export function overlap(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
  }
}
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
function expand(b: Box, p: number): Box {
  return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p }
}
export function imageGeometry(source: Media) {
  const bounds = box(source.getBoundingClientRect()),
    style = getComputedStyle(source)
  const width =
    source instanceof HTMLImageElement
      ? source.naturalWidth
      : source instanceof HTMLVideoElement
        ? source.videoWidth
        : source.width
  const height =
    source instanceof HTMLImageElement
      ? source.naturalHeight
      : source instanceof HTMLVideoElement
        ? source.videoHeight
        : source.height
  const content = { ...bounds }
  for (const [axis, extent, first, last] of [
    ['x', 'w', 'Left', 'Right'],
    ['y', 'h', 'Top', 'Bottom'],
  ] as const) {
    const inset = (side: string) =>
      parseFloat(style.getPropertyValue('border-' + side.toLowerCase() + '-width')) +
      parseFloat(style.getPropertyValue('padding-' + side.toLowerCase()))
    content[axis] += inset(first)
    content[extent] -= inset(first) + inset(last)
  }
  let w = content.w,
    h = content.h
  if (width && height && style.objectFit !== 'fill') {
    let scale = Math.min(w / width, h / height)
    if (style.objectFit === 'cover') scale = Math.max(w / width, h / height)
    if (style.objectFit === 'none') scale = 1
    if (style.objectFit === 'scale-down') scale = Math.min(1, scale)
    w = width * scale
    h = height * scale
  }
  const pos = style.objectPosition.split(' ')
  const offset = (value: string, space: number) =>
    value.endsWith('%') ? (parseFloat(value) * space) / 100 : parseFloat(value) || 0
  const image = {
    x: content.x + offset(pos[0], content.w - w),
    y: content.y + offset(pos[1] ?? '50%', content.h - h),
    w,
    h,
  }
  return { image, clip: overlap(content, image), width, height }
}
function program(gl: WebGL2RenderingContext, fragment: string) {
  const linked = gl.createProgram()!
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed')
    gl.attachShader(linked, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(linked)
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS))
    throw Error(gl.getProgramInfoLog(linked) ?? 'Shader link failed')
  const locations = new Map<string, WebGLUniformLocation | null>()
  return {
    id: linked,
    u(name: string) {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(linked, name))
      return locations.get(name)!
    },
  }
}
function texture(gl: WebGL2RenderingContext) {
  const t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
function gaussian(sigma: number) {
  const count = Math.min(10, Math.ceil(3 * sigma)),
    weights = [1],
    pairs = new Float32Array(10)
  for (let i = 1; i <= count; i++) weights.push(Math.exp((-i * i) / (2 * sigma * sigma)))
  const total = weights.reduce((a, b) => a + b) * 2 - 1
  for (let i = 1; i <= count; i += 2) {
    const next = weights[i + 1] || 0,
      sum = weights[i] + next
    pairs[i - 1] = i + next / sum
    pairs[i] = sum / total
  }
  return { center: 1 / total, pairs, count: Math.ceil(count / 2) }
}
export class Renderer {
  readonly canvas = document.createElement('canvas')
  readonly gl: WebGL2RenderingContext
  private blur
  private glass
  private sourceTex
  private ping
  private pong
  private fb
  private allocated = ''
  private cached = ''
  private revision = 0
  private imageSize = ''
  private floatTarget
  private maxSize
  private timer
  private queries: WebGLQuery[] = []
  uploads = 0
  frames = 0
  blurPasses = 0
  gpuMs: number | null = null
  constructor(source: Media) {
    const c = this.canvas
    c.setAttribute('aria-hidden', 'true')
    c.dataset.lgSurface = ''
    c.style.cssText =
      'position:fixed;pointer-events:none;left:0;top:0;margin:0;border:0;padding:0;max-width:none;max-height:none;background:transparent;'
    c.style.zIndex = getComputedStyle(source).zIndex
    const gl = c.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    })
    if (!gl) throw Error('WebGL 2 unavailable')
    this.gl = gl
    try {
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      this.blur = program(gl, blurShader)
      this.glass = program(gl, glassShader)
      this.sourceTex = texture(gl)
      this.ping = texture(gl)
      this.pong = texture(gl)
      this.fb = gl.createFramebuffer()!
      this.floatTarget = Boolean(gl.getExtension('EXT_color_buffer_float'))
      this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      source.after(c)
    } catch (e) {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      throw e
    }
  }
  render(
    source: Media,
    geometry: ReturnType<typeof imageGeometry>,
    panels: Box[],
    m: Material,
    dirty: boolean,
    tier: number,
  ) {
    const { image, clip, width, height } = geometry,
      gl = this.gl,
      c = this.canvas
    const viewport = { x: 0, y: 0, w: innerWidth, h: innerHeight }
    const visible = panels
      .map((p) => overlap(overlap(expand(p, 8), clip), viewport))
      .filter((p) => p.w > 0 && p.h > 0)
    if (!visible.length || !width || !height) {
      c.hidden = true
      return
    }
    const bounds = visible.reduce(union),
      gutter = m.shadow ? 8 : 0
    const x = Math.floor(bounds.x),
      y = Math.floor(bounds.y),
      w = Math.ceil(bounds.x + bounds.w) - x,
      h = Math.ceil(bounds.y + bounds.h) - y
    const dpi = Math.min(
      devicePixelRatio || 1,
      this.maxSize / w,
      this.maxSize / h,
      Math.sqrt(8388608 / (w * h)),
    )
    if (w < 1 || h < 1) return
    c.hidden = false
    if (c.style.width !== w + 'px') c.style.width = w + 'px'
    if (c.style.height !== h + 'px') c.style.height = h + 'px'
    // Fixed positioning is relative to the nearest transformed containing block, if present.
    const offset = c.getBoundingClientRect()
    if (Math.abs(x - offset.x) > 0.01) c.style.left = parseFloat(c.style.left) + x - offset.x + 'px'
    if (Math.abs(y - offset.y) > 0.01) c.style.top = parseFloat(c.style.top) + y - offset.y + 'px'
    const dw = Math.max(1, Math.round(w * dpi)),
      dh = Math.max(1, Math.round(h * dpi))
    if (c.width !== dw) c.width = dw
    if (c.height !== dh) c.height = dh
    if (width > this.maxSize || height > this.maxSize)
      throw Error('Background exceeds GPU texture limit')
    const encoded = !(source instanceof HTMLImageElement)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex)
    if (dirty || this.uploads === 0) {
      if (this.imageSize !== width + 'x' + height) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          encoded ? gl.RGBA8 : gl.SRGB8_ALPHA8,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        )
        if (gl.getError() !== gl.NO_ERROR) throw Error('Background texture allocation failed')
        this.imageSize = width + 'x' + height
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
      this.uploads++
      this.revision++
    }
    const pad = m.blurRadius + m.refraction + m.environmentRadius + 8 + Math.max(w, h) * m.bodyLens
    const region = overlap(expand(bounds, pad), clip)
    const useBlur = m.blurRadius > 0 && m.transparency < 1
    const scale = Math.min(
      dpi,
      (tier === 0 ? 3 : tier === 1 ? 1.9 : 1.25) / Math.max(1, m.blurRadius / 3),
    )
    const bw = Math.max(1, Math.ceil(region.w * scale)),
      bh = Math.max(1, Math.ceil(region.h * scale))
    const setBox = (loc: WebGLUniformLocation | null, b: Box) => gl.uniform4f(loc, b.x, b.y, b.w, b.h)
    const signature = [
      this.revision,
      region.x - image.x,
      region.y - image.y,
      region.w,
      region.h,
      image.w,
      image.h,
      bw,
      bh,
      m.blurRadius,
      ...visible.flatMap((b) => [b.x - image.x, b.y - image.y, b.w, b.h]),
      pad,
    ].join(',')
    if (this.timer && this.queries.length) {
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT)
      if (disjoint) this.gpuMs = null
      while (
        this.queries.length &&
        (disjoint || gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE))
      ) {
        const q = this.queries.shift()!
        if (!disjoint) this.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
        gl.deleteQuery(q)
      }
    }
    const query = this.timer && this.queries.length < 3 ? gl.createQuery() : null
    if (query) gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query)
    gl.activeTexture(gl.TEXTURE1)
    if (useBlur && signature !== this.cached) {
      const p = this.blur,
        g = gaussian(Math.max(0.01, (m.blurRadius / 3) * scale))
      const size = bw + 'x' + bh
      const resized = this.allocated !== size
      if (resized) {
        for (const tex of [this.ping, this.pong]) {
          gl.bindTexture(gl.TEXTURE_2D, tex)
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            this.floatTarget ? gl.RGBA16F : gl.RGBA8,
            bw,
            bh,
            0,
            gl.RGBA,
            this.floatTarget ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
            null,
          )
        }
        this.allocated = size
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
      gl.viewport(0, 0, bw, bh)
      gl.useProgram(p.id)
      setBox(p.u('sourceBox'), image)
      setBox(p.u('crop'), region)
      gl.uniform1i(p.u('sharp'), 0)
      gl.uniform1i(p.u('blurred'), 1)
      gl.uniform1i(p.u('encodedSource'), Number(encoded))
      gl.uniform1f(p.u('centerWeight'), g.center)
      gl.uniform1i(p.u('pairCount'), g.count)
      gl.uniform2fv(p.u('pairs'), g.pairs)
      for (const horizontal of [true, false]) {
        gl.bindTexture(gl.TEXTURE_2D, horizontal ? this.sourceTex : this.ping)
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          horizontal ? this.ping : this.pong,
          0,
        )
        if (resized && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw Error('Blur framebuffer unavailable')
        gl.uniform1i(p.u('firstPass'), Number(horizontal))
        gl.uniform2f(p.u('stepUV'), horizontal ? 1 / bw : 0, horizontal ? 0 : 1 / bh)
        // Large gaps between panels need no filtering. Both passes retain the Gaussian support.
        if (
          visible.length > 1 &&
          visible.reduce((area, b) => area + (b.w + 2 * pad) * (b.h + 2 * pad), 0) <
            region.w * region.h * 0.85
        ) {
          gl.enable(gl.SCISSOR_TEST)
          for (const bounds of visible) {
            const r = overlap(expand(bounds, pad), region)
            const x0 = Math.floor(((r.x - region.x) * bw) / region.w),
              y0 = Math.floor(((r.y - region.y) * bh) / region.h)
            gl.scissor(
              x0,
              y0,
              Math.ceil(((r.x + r.w - region.x) * bw) / region.w) - x0,
              Math.ceil(((r.y + r.h - region.y) * bh) / region.h) - y0,
            )
            gl.drawArrays(gl.TRIANGLES, 0, 3)
          }
          gl.disable(gl.SCISSOR_TEST)
        } else gl.drawArrays(gl.TRIANGLES, 0, 3)
        this.blurPasses++
      }
      this.cached = signature
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindTexture(gl.TEXTURE_2D, useBlur ? this.pong : this.sourceTex)
    const p = this.glass
    gl.useProgram(p.id)
    setBox(p.u('sourceBox'), image)
    setBox(p.u('crop'), region)
    gl.uniform1i(p.u('sharp'), 0)
    gl.uniform1i(p.u('blurred'), 1)
    gl.uniform1f(p.u('dpi'), dpi)
    gl.uniform1i(p.u('encodedSource'), Number(encoded))
    gl.uniform4f(p.u('optics'), m.radius, m.bevel, m.ior, m.refraction)
    gl.uniform4f(p.u('light'), m.highlight, m.innerContour, 0, 0)
    gl.uniform4f(
      p.u('env'),
      m.contour === 'white' ? 0 : m.environmentStrength,
      m.environmentRadius,
      0,
      0,
    )
    gl.uniform4f(p.u('finish'), m.bodyLens, Number(m.shadow), 0, 0)
    gl.uniform1f(p.u('compression'), m.protection ? m.compression : 0)
    gl.uniform1f(p.u('transparent'), m.transparency)
    gl.uniform1f(p.u('gutter'), gutter)
    gl.uniform1f(p.u('hasBlur'), Number(useBlur))
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    for (const panel of panels) {
      const bb = expand(panel, gutter),
        xs = Math.round((bb.x - x) * dpi),
        ys = Math.round((bb.y - y) * dpi)
      gl.viewport(
        xs,
        dh - Math.round((bb.y + bb.h - y) * dpi),
        Math.max(1, Math.round((bb.x + bb.w - x) * dpi) - xs),
        Math.max(1, Math.round((bb.y + bb.h - y) * dpi) - ys),
      )
      setBox(p.u('panel'), panel)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.disable(gl.BLEND)
    if (query) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT)
      this.queries.push(query)
    }
    this.frames++
  }
  dispose() {
    this.canvas.remove()
    const gl = this.gl
    for (const q of this.queries) gl.deleteQuery(q)
    for (const t of [this.sourceTex, this.ping, this.pong]) gl.deleteTexture(t)
    gl.deleteFramebuffer(this.fb)
    gl.deleteProgram(this.blur.id)
    gl.deleteProgram(this.glass.id)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
