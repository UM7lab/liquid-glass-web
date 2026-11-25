import { LiquidGlass, defaults, limits } from '../dist/index.js'
const get = (id) => document.getElementById(id)
const canvas = get('source'),
  ctx = canvas.getContext('2d', { alpha: false }),
  card = document.querySelector('.sample')
let settings = { ...defaults },
  controller,
  playing = false,
  frame = 0,
  phase = 0
function draw() {
  const w = canvas.width,
    h = canvas.height,
    name = get('scene').value
  const palettes = {
    Spectrum: ['#183e42', '#5fc2b4', '#eee3ac', '#e0a478', '#962e67', '#401d49'],
    Grid: ['#173b47', '#4a7a81', '#c3e6d4'],
    Daylight: ['#fffbed', '#ebd9b0', '#acc8be'],
    Midnight: ['#061123', '#12243b', '#294753'],
  }
  const colors = palettes[name],
    g = ctx.createLinearGradient(0, h, w, 0)
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  if (name === 'Grid') {
    ctx.strokeStyle = 'rgba(246,254,246,.65)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = 0; x < w; x += 42) {
      ctx.moveTo(x + (phase % 42), 0)
      ctx.lineTo(x + (phase % 42), h)
    }
    for (let y = 0; y < h; y += 42) {
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
  } else {
    ctx.translate(w * 0.19, h * 0.66)
    ctx.rotate(-0.49)
    ctx.scale(1.7, 0.8)
    for (let i = 0; i < 170; i++) {
      const r = 76 + i * 5
      ctx.beginPath()
      ctx.ellipse(Math.sin(i * 0.026 + phase * 0.008) * 37, 0, r, r * 0.72, 0, 0, Math.PI * 2)
      ctx.strokeStyle = i % 8 === 0 ? 'rgba(255,248,216,.50)' : 'rgba(40,39,49,.20)'
      ctx.lineWidth = i % 8 === 0 ? 2.5 : 1
      ctx.stroke()
    }
  }
  ctx.restore()
  controller?.invalidate()
}
function connect() {
  controller?.stop()
  controller = new LiquidGlass({
    targets: card,
    source: get('mode').value === 'texture' ? canvas : null,
    material: settings,
  }).start()
  showStatus()
}
function showStatus() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const s = controller.status
      get('status').textContent = s.mode + ' · ' + (s.mode === 'webgl2' ? s.quality : s.reason)
    }),
  )
}
const names = {
  ior: 'Index of refraction',
  transparency: 'Transparency',
  blurRadius: 'Blur radius',
  refraction: 'Edge displacement',
  highlight: 'Highlight',
  environmentStrength: 'Environment color',
  environmentRadius: 'Sampling radius',
  compression: 'Brightness compression',
  radius: 'Corner radius',
  bevel: 'Bevel width',
  bodyLens: 'Body magnification',
  innerContour: 'Inner contour',
}
const inputs = new Map()
function update(key, value) {
  controller.update({ [key]: value })
  settings = controller.settings
  sync()
}
function sync() {
  for (const [key, { input, read }] of inputs) {
    const v = settings[key]
    if (input.type === 'checkbox') input.checked = v
    else input.value = v
    if (read) read.textContent = display(key, v)
  }
  showStatus()
}
function display(key, v) {
  if (key === 'ior') return Number(v.toFixed(4)).toString()
  if (limits[key][1] <= 1) return Math.round(v * 100) + '%'
  return v + ' px'
}
for (const [key, label] of Object.entries(names)) {
  const row = document.createElement('div')
  row.className = 'row'
  const top = document.createElement('div')
  top.className = 'row-top'
  const title = document.createElement('label')
  title.htmlFor = key
  title.textContent = label
  const read = document.createElement('output'),
    reset = document.createElement('button')
  reset.textContent = '↺'
  reset.setAttribute('aria-label', 'Reset ' + label)
  const input = document.createElement('input')
  input.type = 'range'
  input.id = key
  const [min, max] = limits[key]
  input.min = min
  input.max = max
  input.step = key === 'ior' ? 0.0001 : max <= 1 ? 0.001 : 1
  reset.onclick = () => update(key, defaults[key])
  input.oninput = () => update(key, Number(input.value))
  top.append(title, read, reset)
  row.append(top, input)
  get(
    ['ior', 'transparency', 'blurRadius', 'refraction', 'radius'].includes(key)
      ? 'controls'
      : 'advanced',
  ).append(row)
  inputs.set(key, { input, read })
}
for (const [key, label] of [
  ['protection', 'Protect text readability'],
  ['shadow', 'Soft shadow'],
  ['contour', 'Contour color'],
]) {
  const row = document.createElement('label')
  row.className = 'toggle'
  row.append(label)
  const input = document.createElement(key === 'contour' ? 'select' : 'input')
  if (key === 'contour') {
    for (const v of ['environment', 'white']) input.add(new Option(v, v))
  } else input.type = 'checkbox'
  input.onchange = () => update(key, key === 'contour' ? input.value : input.checked)
  row.append(input)
  get('advanced').append(row)
  inputs.set(key, { input })
}
function animate(t) {
  phase = t * 0.018
  draw()
  if (playing) frame = requestAnimationFrame(animate)
}
get('play').onclick = () => {
  playing = !playing
  get('play').textContent = playing ? 'Pause' : 'Play'
  get('play').setAttribute('aria-pressed', playing)
  if (playing) frame = requestAnimationFrame(animate)
  else cancelAnimationFrame(frame)
}
get('reset').onclick = () => {
  controller.reset()
  settings = controller.settings
  sync()
}
get('scene').onchange = draw
get('mode').onchange = connect
draw()
connect()
sync()
