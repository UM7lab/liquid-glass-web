export const defaults = Object.freeze({
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
  contour: 'environment' as 'environment' | 'white',
})
export type Material = {
  -readonly [K in keyof typeof defaults]: (typeof defaults)[K] extends number
    ? number
    : (typeof defaults)[K] extends boolean
      ? boolean
      : (typeof defaults)[K]
}
export const limits = {
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
  compression: [0, 1],
} as const
export function material(patch: Partial<Material>, current: Material = { ...defaults }): Material {
  const next = { ...current }
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = patch[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      const [min, max] = limits[key]
      next[key] = Math.min(max, Math.max(min, value))
    }
  }
  for (const key of ['protection', 'shadow'] as const)
    if (typeof patch[key] === 'boolean') next[key] = patch[key]!
  if (patch.contour === 'white' || patch.contour === 'environment') next.contour = patch.contour
  return next
}
export const bypass = (m: Material) => m.transparency === 1 && (!m.protection || m.compression === 0)
export function smoother(t: number) {
  t = Math.min(1, Math.max(0, t))
  return t * t * t * (t * (6 * t - 15) + 10)
}
export function slope(c: number, n: number) {
  const k = Math.sqrt(Math.max(0, n * n - 1))
  return -k / (Math.sqrt(c * c + k * k) + Math.max(c, 0.00001) * n * n)
}
