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

/** True when `url` is an https URL in this deployment's own public Blob store whose path matches `path`. */
function isStoreUrl(url: string, path: RegExp, env: Record<string, string | undefined>): boolean {
  const store = blobStoreId(env)
  if (!store) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === `${store}.public.blob.vercel-storage.com` && path.test(parsed.pathname.slice(1))
  } catch {
    return false
  }
}

export function isOwnPhotoUrl(url: string, env: Record<string, string | undefined> = process.env): boolean {
  return isStoreUrl(url, UPLOADED, env)
}

const FORGE_ASSET = /^forge\/[0-9a-f-]{36}\/[a-z0-9]+\/\d+\/[a-z0-9-]+\.(png|webp|svg|glb|fbx|json)$|^forge\/[0-9a-f-]{36}\/package\.json$/

/** Forge outputs live under forge/<forgeId>/ in this deployment's store (KTD9); nothing else is accepted. */
export function isOwnForgeAssetUrl(url: string, env: Record<string, string | undefined> = process.env): boolean {
  return isStoreUrl(url, FORGE_ASSET, env)
}
