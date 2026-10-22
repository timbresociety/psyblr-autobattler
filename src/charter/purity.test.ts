import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The Charter core and the simulation run in the browser, in Node and in serverless functions (KTD1). */
const ROOTS = ['src/charter', 'src/sim']
const FORBIDDEN = [/from ['"]react/, /from ['"]react-dom/, /\bdocument\./, /\bwindow\./, /\blocalStorage\b/]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.worker\.ts$/.test(name) ? [path] : []
  })
}

export function impurities(source: string): RegExp[] {
  return FORBIDDEN.filter((pattern) => pattern.test(source))
}

describe('framework-free core', () => {
  it('no core or sim module imports React or touches the DOM', () => {
    for (const path of ROOTS.flatMap(files)) {
      expect({ path, hits: impurities(readFileSync(path, 'utf8')).map(String) }).toEqual({ path, hits: [] })
    }
  })

  it('the checker catches a React import', () => {
    expect(impurities("import { useState } from 'react'")).not.toHaveLength(0)
    expect(impurities('const el = document.body')).not.toHaveLength(0)
  })
})
