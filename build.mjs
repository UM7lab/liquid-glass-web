import { build } from 'esbuild'
await build({
  entryPoints: ['src/index.ts', 'src/react.ts'],
  outdir: 'dist',
  platform: 'browser',
  format: 'esm',
  bundle: true,
  external: ['react', './index.js'],
  target: 'es2020',
})
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/glass.global.js',
  format: 'iife',
  globalName: 'LiquidGlassWeb',
  bundle: true,
  minify: true,
  target: 'es2020',
})
