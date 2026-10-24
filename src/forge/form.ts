import type { Build } from '../charter/build.js'
import { getTemplate } from '../charter/templates/catalog.js'

/** The size class a hero's transforming ultimate reaches, whose body the arena loads for the form. */
export function formSize(build: Build | undefined) {
  const resize = build && getTemplate(build.slots.ultimate.templateId).effects.find((e) => e.kind === 'resize')
  return resize && resize.kind === 'resize' ? resize.sizeClass : undefined
}
