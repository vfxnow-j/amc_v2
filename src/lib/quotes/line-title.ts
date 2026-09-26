/**
 * What a quote shows for one order line: the asset's name as the title and, when
 * the line carries a description of its own (a configured spec, a note), that
 * description on a smaller line beneath. Ported from v1 3fd469e. Before this the
 * PDF dropped the description whenever an asset was set, and the online quote
 * did the reverse and hid the asset name.
 */
export function lineTitle(item: {
  description?: string | null
  asset?: { name: string } | null
}): { title: string; spec?: string } {
  const description = item.description?.trim() || ''
  const assetName = item.asset?.name?.trim() || ''
  const title = assetName || description || 'Ad-hoc item'
  return description && description !== title ? { title, spec: description } : { title }
}
