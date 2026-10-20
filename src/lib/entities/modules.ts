export type ModuleKey = 'INVENTORY' | 'OPERATE' | 'SERVICE_CENTER'

export type ModuleDef = { key: ModuleKey; label: string; blurb: string; available: boolean }

/** Only Inventory is built. The rest show greyed out as "coming soon". */
export const MODULES: ModuleDef[] = [
  { key: 'INVENTORY', label: 'Inventory', blurb: 'Items, units, locations, receive, release and return.', available: true },
  { key: 'OPERATE', label: 'Operate', blurb: 'Coming soon.', available: false },
  { key: 'SERVICE_CENTER', label: 'Service Center', blurb: 'Coming soon.', available: false },
]

export const DEFAULT_MODULES: ModuleKey[] = ['INVENTORY']
