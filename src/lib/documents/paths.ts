import path from 'path'

// In standalone mode process.cwd() resolves to .next/standalone/ which gets
// wiped on every rebuild. Use a stable project-root path for persistent storage.
export function getProjectRoot(): string {
  const cwd = process.cwd()
  // Standalone server runs from <project>/.next/standalone
  if (cwd.endsWith(path.join('.next', 'standalone'))) {
    return path.resolve(cwd, '..', '..')
  }
  return cwd
}

export const DOCUMENTS_ROOT = path.join(getProjectRoot(), 'documents')

/**
 * Resolve a document filePath (stored in DB) to an absolute filesystem path.
 * Handles both old absolute paths and new relative paths transparently.
 *
 * Plain module (no 'use server') — this is path arithmetic only, no I/O, but
 * it moved out of documents.ts alongside the rest of the shared path helpers
 * so a "use server" file never has to export non-function consts.
 */
export async function resolveDocPath(filePath: string): Promise<string> {
  if (!path.isAbsolute(filePath)) {
    return path.join(DOCUMENTS_ROOT, filePath)
  }
  // Absolute path — extract relative portion after /documents/
  const docsIdx = filePath.indexOf('/documents/')
  if (docsIdx !== -1) {
    const relativePart = filePath.substring(docsIdx + '/documents/'.length)
    return path.join(DOCUMENTS_ROOT, relativePart)
  }
  return filePath
}

/**
 * Convert an absolute filePath to a relative path for DB storage.
 */
export function toRelativePath(absolutePath: string): string {
  if (absolutePath.startsWith(DOCUMENTS_ROOT)) {
    return absolutePath.substring(DOCUMENTS_ROOT.length + 1)
  }
  const docsIdx = absolutePath.indexOf('/documents/')
  if (docsIdx !== -1) {
    return absolutePath.substring(docsIdx + '/documents/'.length)
  }
  return absolutePath
}

export function getEntityFolder(entityType: string): string {
  switch (entityType) {
    case 'RESERVATION': return 'reservations'
    case 'ASSET': return 'assets'
    case 'LEASE': return 'leases'
    case 'FUNDING_REQUEST': return 'funding-requests'
    default: return 'purchase-orders'
  }
}
