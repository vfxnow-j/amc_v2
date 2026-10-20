/** `vfxnow_ent_` + up to 40 of [a-z0-9_]. The guard and provisioning share this. */
export const ENTITY_DB_RE = /^vfxnow_ent_[a-z0-9_]{1,40}$/

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

export function dbNameFor(slug: string): string {
  return `vfxnow_ent_${slug.replace(/-/g, '_')}`
}
