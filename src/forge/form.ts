import { BUILD_SLOTS, type Build } from '../charter/build.js'
import type { SizeClass } from '../charter/sizes.js'
import { getTemplate, hasTemplate } from '../charter/templates/catalog.js'
import type { BuildSlot, Template } from '../charter/types.js'

/** A template's transformation: the class it takes (none when the hero keeps its own size) and how long it lasts. */
export function transformOf(template: Pick<Template, 'effects'>): { size?: SizeClass; duration: number } | undefined {
  for (const e of template.effects) {
    if (e.kind === 'resize') return { size: e.sizeClass, duration: e.duration }
    if (e.kind === 'form') return { duration: e.duration }
  }
  return undefined
}

/** The slot whose skill transforms the hero, if any (the catalogue keeps transformations to ultimates). */
export function formSlot(build: Pick<Build, 'slots'> | undefined): BuildSlot | undefined {
  return build ? BUILD_SLOTS.find((s) => hasTemplate(build.slots[s].templateId) && transformOf(getTemplate(build.slots[s].templateId))) : undefined
}

/** The size class a hero's transformation reaches, whose body the arena loads for the form; none when it keeps its own. */
export function formSize(build: Pick<Build, 'slots'> | undefined): SizeClass | undefined {
  const slot = formSlot(build)
  return slot ? transformOf(getTemplate(build!.slots[slot].templateId))?.size : undefined
}
