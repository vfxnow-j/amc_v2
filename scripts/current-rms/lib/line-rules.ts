/**
 * Editable rules for sorting Current PO lines. First match wins, top to bottom.
 * Add a keyword here when a line lands in the wrong group, and add a test for it.
 */
export type LineGroup = 'whole_unit' | 'core_component' | 'tracked_part' | 'extra' | 'non_asset' | 'unclassified'
export type CoreKind = 'cpu' | 'board' | 'ram' | 'case' | 'psu' | 'cooler' | 'storage'

/** A build is complete only with all of these. */
export const REQUIRED_CORE: CoreKind[] = ['cpu', 'board', 'ram', 'case', 'psu']

/** Vendor SKU prefixes (Supermicro build sheets) — checked first; their descriptions contain words like "Workstation". */
export const PREFIX_RULES: { group: LineGroup; kind: CoreKind | null; re: RegExp }[] = [
  { group: 'core_component', kind: 'board', re: /^\s*MBD-/i },
  { group: 'core_component', kind: 'case', re: /^\s*CSE-/i },
  { group: 'core_component', kind: 'cooler', re: /^\s*(SNK|FAN)-/i },
  { group: 'core_component', kind: 'ram', re: /^\s*MEM-/i },
  { group: 'core_component', kind: 'storage', re: /^\s*HDS-/i },
  { group: 'core_component', kind: 'cpu', re: /^\s*SMP\d{4}/i },
  { group: 'non_asset', kind: null, re: /^\s*(CBL|MCP|SFT)-/i },
]

export const GROUP_RULES: { group: LineGroup; re: RegExp; label: string }[] = [
  { group: 'non_asset', re: /^\s*\d{4}\.\d{2}\.\d{4}\b/, label: 'customs code line' },
  { group: 'extra', re: /\b(shipping|freight|delivery|insurance|handling|tax|fee|discount|surcharge|restocking|charge|assembly)\b/i, label: 'extra' },
  { group: 'non_asset', re: /\b(windows|win ?1[01]|microsoft|install|licen[cs]e|subscription|software|warranty|applecare\+?|support|renewal|coterm|cables?|qsfp|aoc|dac\d|adapter tray|rails?|gdrail|rks\d+|feet|tray|thermal paste|keyboard|mouse|tpm|dvd ?rw|battery|sdxc|sd card|note|pre-payment|box|instapak|carrier)\b|\bcbl-|\*note/i, label: 'non-asset' },
  { group: 'whole_unit', re: /\b(workstation|thinkstation|thinkpad|thingpad|precision|poweredge|xps|laptop|dgx|mac ?studio|mac ?mini|macbook|imac|mac ?pro|rackstation|diskstation|rs\d{3,4}xs|ds\d{3,4}xs|rx\d{4}\w*|qnap|ts-\d{3,4}\w*|jellyfish|glyph|server|rack|switch|powerswitch|fortigate[-\w]*|smart-ups|ups|monitor|display|\d{3}hz|cintiq|z[468] g[45]|camera|lens|gimbal|oculus|quest|mixer|printer)\b|\bcustom \w+ build\b/i, label: 'whole unit' },
  { group: 'tracked_part', re: /\b(rtx ?\d{0,4}\w*|\d{4} ?ti|quadro|geforce|radeon|tesla|a[2456]000|decklink|ultrastudio|connectx|mellanox|x5[24]0[-\w]*|e810[-\w]*|e10g\w*|network (adapter|card|interface)|nic|ethernet (adapter|card)|wifi)\b|\bvcg\d+/i, label: 'tracked part' },
]

export const CORE_RULES: { kind: CoreKind; re: RegExp }[] = [
  { kind: 'cooler', re: /\b(cooler|heat ?sink|aio|kraken|noctua|liquid freezer|liqte|fans?|topfan)\b/i },
  { kind: 'board', re: /\b(motherboard|mainboard|mb|mobo|mbd|atx|strx4|trx40|trx50|wrx80\w*|wrx90\w*|x570|x670e?|x870e?|b550|b650|z690|z790|z890|pro ws)\b/i },
  { kind: 'cpu', re: /\b(ryzen|threadripper|xeon|epyc|core i[3579]|core ultra|processor|cpu|\d{4}y\+?)\b|\bsmp\d{4}/i },
  { kind: 'ram', re: /\b(ram|ddr4|ddr5|d[45]|dimm|rdimm|udimm|memory module|kingston|kingsotn)\b|\bmem-/i },
  { kind: 'case', re: /\b(case|cases|chassis|tower|fra|define [67r]|meshify|torrent|lian ?li|nzxt? (cs|h\d+)|sliger|cx\d{4}\w*|enthoo)\b|\bcse-/i },
  { kind: 'psu', re: /\b(power suppl(y|ies)|psu|supernova|hpt2[-\w]*|sda2[-\w]*|revolt|\d{3,4} ?w(att)?)\b/i },
  { kind: 'storage', re: /\b(ssd|nvme|m\.2|hdd|hard drive|exos|seagate|western digital|wd blue|hat5300[-\w]*|st\d{4,5}nm\w*)\b/i },
]

/** Words too generic to count as a name match. */
export const NAME_STOPWORDS = new Set([
  'amd', 'intel', 'nvidia', 'with', 'black', 'white', 'series', 'desktop', 'processor', 'the', 'and',
  'for', 'gen', 'new', 'edition', 'graphics', 'card', 'core', 'cores', 'thread', 'threads', 'ghz',
  'memory', 'internal', 'solid', 'state', 'drive', 'inc', 'corporation',
])
