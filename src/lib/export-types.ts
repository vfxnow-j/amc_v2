// Export type definitions - can be imported by both client and server components

export type ExportType =
  | 'assets'
  | 'assets-with-rates'
  | 'inventory-value'
  | 'checkouts'
  | 'checkouts-active'
  | 'reservations'
  | 'reservations-active'
  | 'maintenance'
  | 'clients'
  | 'clients-with-balance'
  | 'invoices'
  | 'invoices-outstanding'
  | 'revenue-by-client'
  | 'revenue-by-month'
  | 'asset-utilization'
  | 'traffic-report'
  | 'full-inventory'
  | 'simple-inventory'

export type ExportTypeInfo = {
  id: ExportType
  name: string
  description: string
  category: 'inventory' | 'operations' | 'financial' | 'analytics'
  hasDateRange: boolean
}

export function getExportTypes(): ExportTypeInfo[] {
  return [
    // Inventory
    {
      id: 'assets',
      name: 'Assets',
      description: 'Full asset inventory with all details',
      category: 'inventory',
      hasDateRange: false,
    },
    {
      id: 'assets-with-rates',
      name: 'Assets with Rates',
      description: 'Asset inventory including rental rates',
      category: 'inventory',
      hasDateRange: false,
    },
    {
      id: 'inventory-value',
      name: 'Inventory Value',
      description: 'Asset valuation and depreciation report',
      category: 'inventory',
      hasDateRange: false,
    },

    // Operations
    {
      id: 'checkouts',
      name: 'Checkouts',
      description: 'All checkout records',
      category: 'operations',
      hasDateRange: true,
    },
    {
      id: 'checkouts-active',
      name: 'Active Checkouts',
      description: 'Currently active checkouts only',
      category: 'operations',
      hasDateRange: false,
    },
    {
      id: 'reservations',
      name: 'Reservations',
      description: 'All reservation records',
      category: 'operations',
      hasDateRange: true,
    },
    {
      id: 'reservations-active',
      name: 'Active Reservations',
      description: 'Currently active reservations only',
      category: 'operations',
      hasDateRange: false,
    },
    {
      id: 'maintenance',
      name: 'Maintenance',
      description: 'Maintenance records and costs',
      category: 'operations',
      hasDateRange: true,
    },

    // Financial
    {
      id: 'clients',
      name: 'Clients',
      description: 'Client directory with contact info',
      category: 'financial',
      hasDateRange: false,
    },
    {
      id: 'clients-with-balance',
      name: 'Clients with Balance',
      description: 'Clients with outstanding balances',
      category: 'financial',
      hasDateRange: false,
    },
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'All invoice records',
      category: 'financial',
      hasDateRange: true,
    },
    {
      id: 'invoices-outstanding',
      name: 'Outstanding Invoices',
      description: 'Unpaid invoices only',
      category: 'financial',
      hasDateRange: false,
    },

    // Analytics
    {
      id: 'revenue-by-client',
      name: 'Revenue by Client',
      description: 'Client revenue breakdown',
      category: 'analytics',
      hasDateRange: true,
    },
    {
      id: 'revenue-by-month',
      name: 'Revenue by Month',
      description: 'Monthly revenue trends',
      category: 'analytics',
      hasDateRange: true,
    },
    {
      id: 'asset-utilization',
      name: 'Asset Utilization',
      description: 'Checkout frequency and utilization rates',
      category: 'analytics',
      hasDateRange: true,
    },
    {
      id: 'traffic-report',
      name: 'Traffic Report',
      description: 'Full asset movement history with purchase, depreciation, and loan details',
      category: 'operations',
      hasDateRange: true,
    },
    {
      id: 'full-inventory',
      name: 'Full Inventory Report',
      description: 'Complete asset snapshot with depreciation, ownership, and valuation',
      category: 'inventory',
      hasDateRange: false,
    },
  ]
}
