/**
 * Photos must come from this deployment's own Blob store, through the upload endpoint (size cap, type check,
 * re-encode, rate limit). The store ID comes from BLOB_STORE_ID, or from the read-write token
 * (vercel_blob_rw_<storeId>_<secret>).
 */
export function blobStoreId(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.BLOB_STORE_ID) return env.BLOB_STORE_ID.toLowerCase()
  const match = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(env.BLOB_READ_WRITE_TOKEN ?? '')
  return match?.[1].toLowerCase()
}

const UPLOADED = /^heroes\/[0-9a-f-]{36}(-[A-Za-z0-9]+)?\.webp$/

export function isOwnPhotoUrl(url: string, env: Record<string, string | undefined> = process.env): boolean {
  const store = blobStoreId(env)
  if (!store) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === `${store}.public.blob.vercel-storage.com` && UPLOADED.test(parsed.pathname.slice(1))
  } catch {
    return false
  }
}

const FORGE_ASSET = /^forge\/[0-9a-f-]{36}\/[a-z0-9]+\/\d+\/[a-z0-9-]+\.(png|webp|svg|glb|fbx|json)$|^forge\/[0-9a-f-]{36}\/package\.json$/

/** Forge outputs live under forge/<forgeId>/ in this deployment's store (KTD9); nothing else is accepted. */
export function isOwnForgeAssetUrl(url: string, env: Record<string, string | undefined> = process.env): boolean {
  const store = blobStoreId(env)
  if (!store) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === `${store}.public.blob.vercel-storage.com` && FORGE_ASSET.test(parsed.pathname.slice(1))
  } catch {
    return false
  }
}
