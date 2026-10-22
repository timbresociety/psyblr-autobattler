// Component tests opt into jsdom per file with `// @vitest-environment jsdom`.
// The Charter core and the simulation run in plain Node, the same as `npm run sim`.

// No test may reach a real provider: paid generation is never called while building or testing.
// Tests that exercise live adapters pass their own mocked fetch.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`network disabled in tests: ${String(input)}`)
}) as typeof fetch

export {}
