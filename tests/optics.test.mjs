import assert from 'node:assert/strict'
import test from 'node:test'
import { defaults, limits, LiquidGlass } from '../dist/index.js'
test('default material matches the native preset', () => {
  assert.equal(defaults.ior, 1.5168)
  assert.equal(defaults.refraction, 6)
  assert.equal(defaults.transparency, 0)
  assert.equal(defaults.blurRadius, 18)
  assert.equal(defaults.compression, 0.5)
  assert.equal(defaults.bodyLens, 0)
})
test('controls are independent, bounded and independently resettable', () => {
  const glass = new LiquidGlass({ targets: [] })
  for (const [name, [low, high]] of Object.entries(limits)) {
    glass.update({ [name]: low - 1 })
    assert.equal(glass.settings[name], low)
    glass.update({ [name]: high + 1 })
    assert.equal(glass.settings[name], high)
    glass.update({ [name]: NaN })
    assert.equal(glass.settings[name], high)
    glass.reset(name)
    assert.equal(glass.settings[name], defaults[name])
  }
  glass.update({ transparency: 1, ior: 1, protection: false })
  glass.reset('ior')
  assert.equal(glass.settings.transparency, 1)
  assert.equal(glass.settings.protection, false)
  assert.equal(glass.settings.ior, defaults.ior)
  glass.reset()
  assert.deepEqual(glass.settings, defaults)
})
test('inspection cannot change live material and importing is SSR safe', () => {
  const g = new LiquidGlass({ targets: [], material: { ior: 1.25 } })
  const copy = g.settings
  copy.ior = 2
  assert.equal(g.settings.ior, 1.25)
  assert.equal(g.status.mode, 'stopped')
  assert.equal(g.status.uploads, 0)
})
