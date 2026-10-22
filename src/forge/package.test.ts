import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, proposeBuild } from '../charter/build'
import { SCHEMA_SQL } from '../server/db'
import { isOwnForgeAssetUrl } from '../server/photo-url'
import { PACKAGE_VERSION, validatePackage, type HeroPackage } from './package'

const build = proposeBuild({ heroName: 'Test', roleId: 'mage', skills: {} }).build
const url = (p: string) => `https://blob.test/forge/${p}`

function pkg(): HeroPackage {
  const slots = Object.fromEntries(
    BUILD_SLOTS.map((slot) => [
      slot,
      {
        templateId: build.slots[slot].templateId,
        motion: { id: 'preset-idle', label: 'Idle', play: { kind: 'preset', preset: 'idle' } },
        ...(['active1', 'active2', 'ultimate'].includes(slot) ? { effect: { sprites: [url(`${slot}.png`)], chosen: 0, shape: { delivery: 'beam', range: 12 } } } : {}),
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
    assets: { sheet: [url('sheet.png')], front: url('sheet.png'), quadMesh: { url: url('mesh.fbx'), format: 'fbx' }, rigged: { url: url('rig.glb'), format: 'glb' }, motions: [{ url: url('m.glb'), format: 'glb', presets: ['idle'] }] },
    slots,
    passive: { visual: 'aura', sprites: [url('aura.png')] },
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
