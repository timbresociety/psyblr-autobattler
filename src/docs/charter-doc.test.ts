import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEMO_HEROES } from '../arena/demo/roster'
import { ROLES } from '../charter/roles'
import { CHARGE_LABEL, ELEMENT_LABEL, FORM_AURA_LABEL, FORM_AVATAR_LABEL, FORM_ENTRY_LABEL, FORM_GROWTH_LABEL, FORM_LABEL, FORM_MARK_LABEL, FORM_TRAIL_LABEL, IMPACT_LABEL, MOTIF_LABEL, POSE_LABEL, TRAIL_LABEL } from '../charter/skill-look'
import { CATALOG } from '../charter/templates/catalog'
import { TRAITS } from '../charter/traits'
import { FORM_TEMPLATES } from '../forge/form'
import { LIBRARY } from '../kit/wear/library'
import { PRINT_LABEL } from '../kit/wear/prints'
import { FINISH_LABEL, KNOB_LABEL, RUNG_LABEL } from '../ui/forge/wardrobe'
import { charterDoc } from './charter-doc'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const root = join(import.meta.dirname, '../..')

describe('the character charter (docs/charter/character-charter.html)', () => {
  const html = charterDoc()

  it('is current with the code', () => {
    const committed = readFileSync(join(root, 'docs/charter/character-charter.html'), 'utf8')
    expect(committed === html, 'the charter is stale: run npx tsx scripts/charter-doc.ts').toBe(true)
  })

  it('covers what the engine owns: every role and its trait, every template, every transformation', () => {
    for (const role of ROLES) expect(html).toContain(`<b>${TRAITS[role.id].name}</b>`)
    for (const template of CATALOG) expect(html).toContain(`<code>${template.id}</code>`)
    const forms = html.slice(html.indexOf('<section id="transformations">'), html.indexOf('<section id="balance">'))
    for (const template of FORM_TEMPLATES) expect(forms).toContain(`<code>${template.id}</code>`)
  })

  it('covers what you own: every library item, rung, finish, cut, print, and every part of a skill look and a form', () => {
    for (const item of LIBRARY) expect(html).toContain(`<b>${esc(item.name)}</b><code>${esc(item.id)}</code>`)
    const labels = [RUNG_LABEL, FINISH_LABEL, KNOB_LABEL, PRINT_LABEL, ELEMENT_LABEL, FORM_LABEL, POSE_LABEL, CHARGE_LABEL, IMPACT_LABEL, TRAIL_LABEL, MOTIF_LABEL, FORM_ENTRY_LABEL, FORM_AURA_LABEL, FORM_GROWTH_LABEL, FORM_TRAIL_LABEL, FORM_AVATAR_LABEL, FORM_MARK_LABEL]
    const lower = html.toLowerCase()
    for (const label of labels.flatMap((l) => Object.values(l))) expect(lower, label).toContain(esc(label).toLowerCase())
  })

  it('shows all twenty starters built from the library, and every picture it shows exists', () => {
    for (const hero of DEMO_HEROES) expect(html).toContain(`<b>${esc(hero.heroName)}</b>`)
    const pictures = [...html.matchAll(/src="\.\.\/\.\.\/public([^"]+)"/g)].map((m) => m[1])
    expect(pictures.length).toBeGreaterThanOrEqual(LIBRARY.length + DEMO_HEROES.length)
    for (const path of new Set(pictures)) expect(existsSync(join(root, 'public', path)), path).toBe(true)
  })

  it('carries no date, so an unchanged charter regenerates to the same bytes', () => {
    expect(html).not.toMatch(/20\d\d-\d\d-\d\d/)
  })
})
