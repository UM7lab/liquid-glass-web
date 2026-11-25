import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useLiquidGlass } from '../dist/react.js'

function Panel({ ior }) {
  const ref = useLiquidGlass({ source: document.querySelector('#bg'), material: { ior } })
  return (
    <article className="panel" ref={ref}>
      Album details
    </article>
  )
}
const mount = document.createElement('section')
document.querySelector('#stage').append(mount)
const root = createRoot(mount)
window.renderCards = (ior, count) =>
  root.render(
    <StrictMode>
      {Array.from({ length: count }, (_, i) => (
        <Panel key={i} ior={ior} />
      ))}
    </StrictMode>,
  )
window.unmountCards = () => root.unmount()
window.renderCards(1.5168, 2)
