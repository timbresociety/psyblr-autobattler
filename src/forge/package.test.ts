import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, proposeBuild } from '../charter/build'
import { SCHEMA_SQL } from '../server/db'
import { isOwnForgeAssetUrl } from '../server/photo-url'
import { defaultRecipe, passiveRecipe } from '../arena/recipes/defaults'
import { getTemplate } from '../charter/templates/catalog'
import { PACKAGE_VERSION, upgradePackage, validatePackage, type HeroPackage, type HeroPackageV1 } from './package'

const build = proposeBuild({ heroName: 'Test', roleId: 'mage', skills: {} }).build
const url = (p: string) => `https://blob.test/forge/${p}`

function pkg(): HeroPackage {
  const slots = Object.fromEntries(
    BUILD_SLOTS.map((slot) => [
      slot,
      {
        templateId: build.slots[slot].templateId,
        motion: { id: 'preset-idle', label: 'Idle', play: { kind: 'preset', preset: 'idle' } },
        ...(['active1', 'active2', 'ultimate'].includes(slot) ? { effect: { sprites: [url(`${slot}.png`)], chosen: 0, shape: { delivery: 'beam', range: 12 }, recipe: defaultRecipe('beam') } } : {}),
      },
    ]),
  ) as HeroPackage['slots']
  return {
    packageVersion: PACKAGE_VERSION,
    forgeId: 'f',
    heroName: 'Test',
    spec: {} as HeroPackage['spec'],
    build,
    skeleton: 'mixamo',
    assets: {
      sheet: [url('sheet.png')],
      front: url('sheet.png'),
      quadMesh: { url: url('mesh.fbx'), format: 'fbx' },
      rigged: { url: url('rig.glb'), format: 'glb' },
      motions: [{ url: url('m.glb'), format: 'glb', presets: ['idle'] }],
      arena: { focus: { url: url('arena-2k.glb'), format: 'glb' }, other: { url: url('arena-1k.glb'), format: 'glb' }, motions: [{ url: url('am.glb'), format: 'glb', presets: ['idle'] }] },
    },
    slots,
    passive: { visual: 'aura', sprites: [url('aura.png')], recipe: passiveRecipe('aura') },
  }
}

describe('hero package (U10)', () => {
  it('a complete package validates, with every slot motion and effect present', () => {
    expect(validatePackage(pkg())).toEqual([])
  })

  it('reports missing assets and a passive visual that is neither aura nor body element (AE4)', () => {
    const p = pkg()
    p.slots.active2.effect!.sprites = []
    p.assets.rigged.format = 'fbx'
    p.passive.visual = 'cape' as 'aura'
    expect(validatePackage(p)).toEqual(expect.arrayContaining(['missing active2 effect', 'rigged model must be GLB', 'passive visual must be an aura or a body element']))
  })

  it('covers AE7: a stored version 1 package upgrades with default recipes, no form, and its rig as the arena hero', () => {
    const v2 = pkg()
    const { arena, ...assets } = v2.assets
    const v1 = { ...v2, packageVersion: 1, assets, slots: Object.fromEntries(Object.entries(v2.slots).map(([k, s]) => [k, s.effect ? { ...s, effect: { ...s.effect, recipe: undefined } } : s])), passive: { visual: 'aura', sprites: v2.passive.sprites } } as unknown as HeroPackageV1
    expect(arena).toBeDefined()
    const up = upgradePackage(v1)
    expect(up.packageVersion).toBe(PACKAGE_VERSION)
    expect(up.assets.arena.focus).toEqual(v1.assets.rigged)
    expect(up.form).toBeUndefined()
    for (const slot of ['active1', 'active2', 'ultimate'] as const) expect(up.slots[slot].effect!.recipe!.delivery).toBe(getTemplate(up.slots[slot].templateId).delivery.kind)
    expect(validatePackage(up)).toEqual([])
  })

  it('a version 2 package without its arena hero fails, and so does a form at the wrong size', () => {
    const missing = pkg() as unknown as { assets: Record<string, unknown> }
    delete missing.assets.arena
    expect(validatePackage(missing as unknown as HeroPackage)).toContain('missing arena hero')
    const titan = { ...build, slots: { ...build.slots, ultimate: { ...build.slots.ultimate, templateId: 'tank-titan-form' } } }
    const wrong: HeroPackage = { ...pkg(), build: titan, form: { mesh: { url: url('form.glb'), format: 'glb' }, sizeClass: 'huge' } }
    expect(validatePackage(wrong)).toContain("form size does not match the ultimate's transformation")
    expect(validatePackage({ ...wrong, form: { ...wrong.form!, sizeClass: 'colossal' } })).toEqual([])
  })

  it('in strict mode only this store’s forge assets are accepted', () => {
    const env = { BLOB_STORE_ID: 'abc' }
    const id = '0f8e3a52-6d3c-4f43-9a8f-7c1c2c8b1d20'
    expect(isOwnForgeAssetUrl(`https://abc.public.blob.vercel-storage.com/forge/${id}/mesh/1/mesh.fbx`, env)).toBe(true)
    expect(isOwnForgeAssetUrl(`https://abc.public.blob.vercel-storage.com/forge/${id}/package.json`, env)).toBe(true)
    expect(isOwnForgeAssetUrl(`https://evil.public.blob.vercel-storage.com/forge/${id}/mesh/1/mesh.fbx`, env)).toBe(false)
    expect(isOwnForgeAssetUrl(`https://abc.public.blob.vercel-storage.com/heroes/${id}.webp`, env)).toBe(false)
    expect(validatePackage(pkg(), (u) => isOwnForgeAssetUrl(u, env))).toContain('front is not a forge asset')
  })

  it('applying the schema to a pre-Forge database, then again, adds the new columns both times', async () => {
    const pg = new PGlite()
    await pg.exec(SCHEMA_SQL.slice(0, SCHEMA_SQL.indexOf('-- Hero Forge')))
    await pg.exec(SCHEMA_SQL)
    await pg.exec(SCHEMA_SQL)
    const { rows } = await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'heroes'")
    expect(rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(['spec', 'package_url', 'creator_account']))
  })
})
