import { useEffect, useRef } from 'react'
import { LiquidGlass, type Options } from './index.js'
import { material } from './material.js'

type Group = {
  engine: LiquidGlass
  targets: Set<HTMLElement>
  key: string
  source: Options['source']
  quality: Options['quality']
}
const groups = new Set<Group>()
function detach(group: Group, el: HTMLElement) {
  group.targets.delete(el)
  if (group.targets.size) group.engine.refresh()
  else {
    group.engine.stop()
    groups.delete(group)
  }
}
/** Hooks with the same source, quality and material share a renderer. */
export function useLiquidGlass<T extends HTMLElement = HTMLDivElement>(
  options: Omit<Options, 'targets'> = {},
) {
  const ref = useRef<T>(null),
    attached = useRef<{ group: Group; el: HTMLElement } | null>(null)
  const source = options.source ?? null,
    quality = options.quality ?? 'auto'
  const settings = material(options.material ?? {}),
    key = JSON.stringify(settings)
  useEffect(() => {
    const el = ref.current,
      previous = attached.current
    if (!el) {
      if (previous) detach(previous.group, previous.el)
      attached.current = null
      return
    }
    let group = [...groups].find((g) => g.source === source && g.quality === quality && g.key === key)
    if (previous && previous.group === group && previous.el === el) return
    if (
      previous &&
      !group &&
      previous.group.targets.size === 1 &&
      previous.group.source === source &&
      previous.group.quality === quality &&
      previous.el === el
    ) {
      previous.group.key = key
      previous.group.engine.update(settings)
      return
    }
    if (previous) detach(previous.group, previous.el)
    if (!group) {
      const targets = new Set<HTMLElement>([el])
      group = {
        source,
        quality,
        key,
        targets,
        engine: new LiquidGlass({ targets, source, quality, material: settings }).start(),
      }
      groups.add(group)
    } else {
      group.targets.add(el)
      group.engine.refresh()
    }
    attached.current = { group, el }
  })
  useEffect(
    () => () => {
      if (attached.current) detach(attached.current.group, attached.current.el)
      attached.current = null
    },
    [],
  )
  return ref
}
