import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_IN } from '../kit/pieces'
import { HAIR_LABEL, LOOK_COLOR_LABEL } from '../charter/look'
import { ROLES } from '../charter/roles'
import { CATALOG } from '../charter/templates/catalog'
import { TRAITS } from '../charter/traits'
import { charterDoc } from './charter-doc'

describe('the character charter (docs/charter/character-charter.html)', () => {
  it('is current with the code', () => {
    const committed = readFileSync(join(import.meta.dirname, '../../docs/charter/character-charter.html'), 'utf8')
    expect(committed === charterDoc(), 'the charter is stale: run npx tsx scripts/charter-doc.ts').toBe(true)
  })

  it('covers every role and its trait, every template, every hair style, colour region and built-in piece', () => {
    const html = charterDoc()
    for (const role of ROLES) expect(html).toContain(`<b>${TRAITS[role.id].name}</b>`)
    for (const template of CATALOG) expect(html).toContain(`<code>${template.id}</code>`)
    for (const label of [...Object.values(HAIR_LABEL), ...Object.values(LOOK_COLOR_LABEL)]) expect(html).toContain(label)
    for (const piece of BUILT_IN) expect(html).toContain(`<b>${piece.name}</b>`)
    // no date, so an unchanged charter regenerates to the same bytes
    expect(html).not.toMatch(/20\d\d-\d\d-\d\d/)
  })
})
