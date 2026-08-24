// Shared types for client and server components
// These mirror Prisma enums but can be used safely in client code

export type AssetStatus = 'AVAILABLE' | 'CHECKED_OUT' | 'MAINTENANCE' | 'RETIRED' | 'RESERVED' | 'SOLD'

export type CheckoutStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'RETURNED' | 'OVERDUE' | 'CANCELLED'

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'CANCELLED' | 'VOID'

export type PricingType = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'PROJECT' | 'CUSTOM'

export type OwnershipType = 'CASH' | 'CREDIT' | 'LOAN' | 'REVOLVER' | 'DONATED' | 'EXCHANGE' | 'VENDOR_CREDIT'

export type DepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'SUM_OF_YEARS' | 'UNITS_OF_PRODUCTION'

export type DepreciationCategory = 'THREE_YEAR' | 'FIVE_YEAR' | 'SEVEN_YEAR' | 'TEN_YEAR' | 'FIFTEEN_YEAR' | 'TWENTY_YEAR'

export type ReservationStatus = 'DRAFT' | 'QUOTE_SENT' | 'APPROVED' | 'REVISION' | 'PREPARING' | 'SHIPPED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'LOST'

/**
 * Statuses where quote packages can still be added, renamed, duplicated, deleted,
 * or switched. Matches the window where line items and pricing stay editable — a
 * quote that has already been sent (or approved) can still gain another option
 * until the order moves into fulfillment.
 */
export const PACKAGE_EDITABLE_STATUSES: readonly string[] = ['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED']

export type ReservationType = 'RENTAL' | 'SALE' | 'RENT_TO_OWN' | 'CLOUD'

export type BillingCycleType = 'DAILY' | 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY' | 'CUSTOM' | 'ONE_TIME'

export type ReturnCondition = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'DAMAGED'

export type POStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'

export type DocumentType = 'ORDER_DETAIL' | 'DELIVERY_NOTE' | 'INVOICE' | 'PRO_FORMA' | 'PURCHASE_ORDER' | 'PROPOSAL' | 'QUOTE' | 'RENTAL_AGREEMENT'

export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export type MaintenanceType = 'PREVENTIVE' | 'CORRECTIVE' | 'DAMAGE_REPAIR' | 'INSPECTION' | 'CALIBRATION'

export type InventoryAuditStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED'

export type InventoryAuditScope = 'FULL' | 'PARTIAL' | 'CATEGORY' | 'LOCATION' | 'CLIENT_ORDER'

export type AuditItemStatus = 'PENDING' | 'VERIFIED' | 'ISSUE' | 'MISSING' | 'UNEXPECTED'

export type ScannerMode = 'reservation' | 'audit' | 'list'

// Status display configurations
export const assetStatusConfig: Record<AssetStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  AVAILABLE: { label: 'Available', variant: 'default' },
  CHECKED_OUT: { label: 'Checked Out', variant: 'secondary' },
  MAINTENANCE: { label: 'Maintenance', variant: 'outline' },
  RETIRED: { label: 'Retired', variant: 'destructive' },
  RESERVED: { label: 'Reserved', variant: 'secondary' },
  SOLD: { label: 'Sold', variant: 'secondary' },
}

export const checkoutStatusConfig: Record<CheckoutStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PENDING_APPROVAL: { label: 'Pending Approval', variant: 'outline' },
  APPROVED: { label: 'Approved', variant: 'secondary' },
  ACTIVE: { label: 'Active', variant: 'default' },
  RETURNED: { label: 'Returned', variant: 'secondary' },
  OVERDUE: { label: 'Overdue', variant: 'destructive' },
  CANCELLED: { label: 'Canceled', variant: 'outline' },
}

export const invoiceStatusConfig: Record<InvoiceStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  SENT: { label: 'Sent', variant: 'secondary' },
  PAID: { label: 'Paid', variant: 'default' },
  PARTIAL: { label: 'Partial', variant: 'secondary' },
  OVERDUE: { label: 'Overdue', variant: 'destructive' },
  CANCELLED: { label: 'Canceled', variant: 'outline' },
  VOID: { label: 'Void', variant: 'outline' },
}

export const reservationStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  QUOTE_SENT: { label: 'Quote Sent', variant: 'secondary' },
  APPROVED: { label: 'Approved', variant: 'default' },
  REVISION: { label: 'Revision', variant: 'outline' },
  PREPARING: { label: 'Preparing', variant: 'secondary' },
  SHIPPED: { label: 'Shipped', variant: 'secondary' },
  ACTIVE: { label: 'Active', variant: 'default' },
  COMPLETED: { label: 'Completed', variant: 'default' },
  CANCELLED: { label: 'Canceled', variant: 'destructive' },
  LOST: { label: 'Lost', variant: 'destructive' },
}

export const returnConditionConfig: Record<ReturnCondition, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  EXCELLENT: { label: 'Excellent', variant: 'default' },
  GOOD: { label: 'Good', variant: 'secondary' },
  FAIR: { label: 'Fair', variant: 'outline' },
  DAMAGED: { label: 'Damaged', variant: 'destructive' },
}

export const poStatusConfig: Record<POStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  SUBMITTED: { label: 'Submitted', variant: 'secondary' },
  PARTIAL: { label: 'Partially Received', variant: 'secondary' },
  RECEIVED: { label: 'Received', variant: 'default' },
  CANCELLED: { label: 'Canceled', variant: 'destructive' },
}

export const maintenanceStatusConfig: Record<MaintenanceStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  SCHEDULED: { label: 'Scheduled', variant: 'outline' },
  IN_PROGRESS: { label: 'In Progress', variant: 'secondary' },
  COMPLETED: { label: 'Completed', variant: 'default' },
  CANCELLED: { label: 'Canceled', variant: 'destructive' },
}

export const maintenanceTypeConfig: Record<MaintenanceType, { label: string; description: string }> = {
  PREVENTIVE: { label: 'Preventive', description: 'Scheduled maintenance' },
  CORRECTIVE: { label: 'Corrective', description: 'Fix an issue' },
  DAMAGE_REPAIR: { label: 'Damage Repair', description: 'Repair from check-in damage' },
  INSPECTION: { label: 'Inspection', description: 'Regular inspection' },
  CALIBRATION: { label: 'Calibration', description: 'Equipment calibration' },
}

export const inventoryAuditStatusConfig: Record<InventoryAuditStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  IN_PROGRESS: { label: 'In Progress', variant: 'secondary' },
  COMPLETED: { label: 'Completed', variant: 'default' },
}

export const inventoryAuditScopeLabels: Record<InventoryAuditScope, string> = {
  FULL: 'Full Inventory',
  PARTIAL: 'Partial (Selected Assets)',
  CATEGORY: 'By Category',
  LOCATION: 'By Location',
  CLIENT_ORDER: 'By Client / Order',
}

export const auditItemStatusConfig: Record<AuditItemStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PENDING: { label: 'Pending', variant: 'outline' },
  VERIFIED: { label: 'Verified', variant: 'default' },
  ISSUE: { label: 'Issue', variant: 'destructive' },
  MISSING: { label: 'Missing', variant: 'destructive' },
  UNEXPECTED: { label: 'Not on Order', variant: 'destructive' },
}

export const pricingTypeLabels: Record<PricingType, string> = {
  HOURLY: 'Hourly Rate',
  DAILY: 'Daily Rate',
  WEEKLY: 'Weekly Rate',
  MONTHLY: 'Monthly Rate',
  PROJECT: 'Project Rate',
  CUSTOM: 'Custom Rate',
}

export const ownershipTypeLabels: Record<OwnershipType, string> = {
  CASH: 'Cash',
  CREDIT: 'Credit',
  LOAN: 'Loan',
  REVOLVER: 'Revolver',
  DONATED: 'Donated',
  EXCHANGE: 'Exchange',
  VENDOR_CREDIT: 'Vendor Credit',
}

// Purchase methods offered on the PO form. Each maps to an OwnershipType that
// carries over to received AssetUnits. Only the four business-relevant methods
// are offered here (the full OwnershipType enum has more values).
export const PO_PURCHASE_METHODS = ['CASH', 'CREDIT', 'VENDOR_CREDIT', 'LOAN', 'EXCHANGE'] as const
export const poPurchaseMethodLabels: Record<(typeof PO_PURCHASE_METHODS)[number], string> = {
  CASH: 'Cash',
  CREDIT: 'Credit Card',
  VENDOR_CREDIT: 'Vendor Credit',
  LOAN: 'Lease / Loan',
  EXCHANGE: 'Transfer',
}

// What a PO is for. Shown on the PO form, detail page, and submission email.
// "Complete" units vs "Components" (parts assembled into rentable/resale hardware).
export type POOrderType =
  | 'HARDWARE_RENTAL'
  | 'HARDWARE_RENTAL_COMPONENTS'
  | 'HARDWARE_RESALE'
  | 'HARDWARE_RESALE_COMPONENTS'
export const PO_ORDER_TYPES = [
  'HARDWARE_RENTAL',
  'HARDWARE_RENTAL_COMPONENTS',
  'HARDWARE_RESALE',
  'HARDWARE_RESALE_COMPONENTS',
] as const
export const poOrderTypeLabels: Record<POOrderType, string> = {
  HARDWARE_RENTAL: 'Hardware for Rental',
  HARDWARE_RENTAL_COMPONENTS: 'Hardware for Rental (Components)',
  HARDWARE_RESALE: 'Hardware for Resale',
  HARDWARE_RESALE_COMPONENTS: 'Hardware for Resale (Components)',
}

export const depreciationMethodLabels: Record<DepreciationMethod, string> = {
  STRAIGHT_LINE: 'Straight Line',
  DECLINING_BALANCE: 'Declining Balance',
  SUM_OF_YEARS: 'Sum of Years',
  UNITS_OF_PRODUCTION: 'Units of Production',
}

export const depreciationCategoryLabels: Record<DepreciationCategory, string> = {
  THREE_YEAR: '3-Year Property',
  FIVE_YEAR: '5-Year Property',
  SEVEN_YEAR: '7-Year Property',
  TEN_YEAR: '10-Year Property',
  FIFTEEN_YEAR: '15-Year Property',
  TWENTY_YEAR: '20-Year Property',
}

export const depreciationCategoryMonths: Record<DepreciationCategory, number> = {
  THREE_YEAR: 36,
  FIVE_YEAR: 60,
  SEVEN_YEAR: 84,
  TEN_YEAR: 120,
  FIFTEEN_YEAR: 180,
  TWENTY_YEAR: 240,
}

export type DeliveryMethod = 'CUSTOMER_PICKUP' | 'CUSTOMER_DROPOFF' | 'LOCAL_DELIVERY' | 'LOCAL_PICKUP' | 'SMALL_PACKAGE' | 'FREIGHT'

// Delivery direction: methods for sending items TO the client
export const deliveryMethodLabels: Record<string, string> = {
  CUSTOMER_PICKUP: 'Customer Pickup',
  LOCAL_DELIVERY: 'Local Delivery',
  SMALL_PACKAGE: 'Small Package',
  FREIGHT: 'Freight',
}

// Return direction: methods for getting items BACK from the client
export const returnMethodLabels: Record<string, string> = {
  CUSTOMER_DROPOFF: 'Customer Drop Off',
  LOCAL_PICKUP: 'Local Pickup',
  SMALL_PACKAGE: 'Small Package',
  FREIGHT: 'Freight',
}

// Combined labels for display (covers all enum values)
export const allDeliveryMethodLabels: Record<string, string> = {
  CUSTOMER_PICKUP: 'Customer Pickup',
  CUSTOMER_DROPOFF: 'Customer Drop Off',
  LOCAL_DELIVERY: 'Local Delivery',
  LOCAL_PICKUP: 'Local Pickup',
  SMALL_PACKAGE: 'Small Package',
  FREIGHT: 'Freight',
}

export const trackingProviderOptions = ['FedEx', 'UPS', 'USPS', 'DHL', 'Other'] as const

export type DiscountType = 'PERCENTAGE' | 'FIXED'

export const discountTypeLabels: Record<DiscountType, string> = {
  PERCENTAGE: 'Percentage (%)',
  FIXED: 'Fixed Amount ($)',
}

export const documentTypeLabels: Record<DocumentType, string> = {
  ORDER_DETAIL: 'Order Detail',
  DELIVERY_NOTE: 'Delivery Note',
  INVOICE: 'Invoice',
  PRO_FORMA: 'Pro Forma Invoice',
  PURCHASE_ORDER: 'Purchase Order',
  PROPOSAL: 'Proposal',
  QUOTE: 'Quote',
  RENTAL_AGREEMENT: 'Rental Agreement',
}

export const billingCycleTypeLabels: Record<BillingCycleType, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  BI_WEEKLY: 'Bi-Weekly',
  MONTHLY: 'Monthly',
  CUSTOM: 'Custom Period',
  ONE_TIME: 'One-Time Charge',
}

export const reservationTypeLabels: Record<ReservationType, string> = {
  RENTAL: 'Rental',
  SALE: 'Sale',
  RENT_TO_OWN: 'Rent-to-Own (RTO)',
  CLOUD: 'Cloud Services',
}

export const reservationTypeDescriptions: Record<ReservationType, string> = {
  RENTAL: 'Equipment rental - items are returned after the rental period',
  SALE: 'Equipment sale - ownership transfers to client',
  RENT_TO_OWN: 'Equipment financing - fixed monthly payments toward ownership',
  CLOUD: 'Cloud services subscription',
}

export const RTO_TERM_OPTIONS = [3, 6, 12, 24, 36] as const
export const rtoTermLabels: Record<number, string> = {
  3: '3 Months',
  6: '6 Months',
  12: '12 Months',
  24: '24 Months',
  36: '36 Months',
}

export const billingCycleTypeDescriptions: Record<BillingCycleType, string> = {
  DAILY: 'Bill every day — line items price off the daily rate',
  WEEKLY: 'Bill every 7 days',
  BI_WEEKLY: 'Bill every 14 days',
  MONTHLY: 'Bill on a specific day each month',
  CUSTOM: 'Bill every specified number of days — line items price off the daily rate',
  ONE_TIME: 'Single charge for the entire rental period',
}

// Days of week for weekly billing
export const daysOfWeek = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

// Status timeline configurations
export const reservationStatusTimelineConfig: Record<string, {
  label: string; description: string; step: number
}> = {
  DRAFT: { label: 'Draft', description: 'Order created', step: 1 },
  QUOTE_SENT: { label: 'Quote Sent', description: 'Awaiting client response', step: 2 },
  APPROVED: { label: 'Approved', description: 'Quote approved', step: 3 },
  REVISION: { label: 'Revision', description: 'Client requested changes', step: 2 },
  PREPARING: { label: 'Preparing', description: 'Items being prepared', step: 4 },
  SHIPPED: { label: 'Shipped', description: 'Items shipped', step: 5 },
  ACTIVE: { label: 'Active', description: 'Items checked out', step: 6 },
  COMPLETED: { label: 'Completed', description: 'All items returned', step: 7 },
  CANCELLED: { label: 'Canceled', description: 'Order canceled', step: -1 },
  LOST: { label: 'Lost', description: 'Quote rejected', step: -1 },
}

/**
 * Derive ownership status from existing data — no manual toggles needed.
 * OWNED: Cash, Credit, Donated, Exchange, or Loan where revenue >= loanAmount (paid off)
 * NOT_OWNED: Active Loan with outstanding balance, Revolver, or any Retired/Sold unit
 */
export function getDerivedOwnershipStatus(
  ownershipType: OwnershipType,
  loanAmount: number | null | undefined,
  totalRevenue: number | null | undefined,
  assetStatus?: AssetStatus | string,
): 'OWNED' | 'NOT_OWNED' | null {
  // Retired units — ownership not applicable
  if (assetStatus === 'RETIRED') {
    return null
  }

  switch (ownershipType) {
    case 'CASH':
    case 'CREDIT':
    case 'DONATED':
    case 'EXCHANGE':
      return 'OWNED'
    case 'REVOLVER':
      return 'NOT_OWNED'
    case 'LOAN': {
      const loan = Number(loanAmount) || 0
      const revenue = Number(totalRevenue) || 0
      return loan > 0 && revenue >= loan ? 'OWNED' : 'NOT_OWNED'
    }
    default:
      return 'OWNED'
  }
}

export const saleStatusTimelineConfig: Record<string, {
  label: string; description: string; step: number
}> = {
  DRAFT: { label: 'Draft', description: 'Sale order created', step: 1 },
  QUOTE_SENT: { label: 'Quote Sent', description: 'Awaiting client response', step: 2 },
  APPROVED: { label: 'Approved', description: 'Sale approved', step: 3 },
  REVISION: { label: 'Revision', description: 'Client requested changes', step: 2 },
  PREPARING: { label: 'Preparing', description: 'Pulling items', step: 4 },
  SHIPPED: { label: 'Shipped', description: 'Items shipped', step: 5 },
  ACTIVE: { label: 'Processing', description: 'Preparing items', step: 6 },
  COMPLETED: { label: 'Sold', description: 'Items transferred to buyer', step: 6 },
  CANCELLED: { label: 'Canceled', description: 'Sale canceled', step: -1 },
  LOST: { label: 'Lost', description: 'Quote rejected', step: -1 },
}

export const rtoStatusTimelineConfig: Record<string, {
  label: string; description: string; step: number
}> = {
  DRAFT: { label: 'Draft', description: 'RTO agreement created', step: 1 },
  QUOTE_SENT: { label: 'Quote Sent', description: 'Awaiting client approval', step: 2 },
  APPROVED: { label: 'Approved', description: 'RTO agreement approved', step: 3 },
  REVISION: { label: 'Revision', description: 'Client requested changes', step: 2 },
  PREPARING: { label: 'Preparing', description: 'Items being prepared', step: 4 },
  SHIPPED: { label: 'Shipped', description: 'Items shipped', step: 5 },
  ACTIVE: { label: 'Active', description: 'RTO payments in progress', step: 6 },
  COMPLETED: { label: 'Owned', description: 'All installments paid — ownership transferred', step: 7 },
  CANCELLED: { label: 'Canceled', description: 'RTO agreement canceled', step: -1 },
  LOST: { label: 'Lost', description: 'Quote rejected', step: -1 },
}

// ============================================
// SERVICE COVERAGE
// ============================================

export type CoverageType = 'LICENSE' | 'SUPPORT_CONTRACT' | 'EXTENDED_WARRANTY' | 'SERVICE_PLAN' | 'SUBSCRIPTION'

export const coverageTypeLabels: Record<CoverageType, string> = {
  LICENSE: 'License',
  SUPPORT_CONTRACT: 'Support Contract',
  EXTENDED_WARRANTY: 'Extended Warranty',
  SERVICE_PLAN: 'Service Plan',
  SUBSCRIPTION: 'Subscription',
}

export type CoverageStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'UPCOMING'

export const coverageStatusConfig: Record<CoverageStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  ACTIVE: { label: 'Active', variant: 'default' },
  EXPIRING_SOON: { label: 'Expiring Soon', variant: 'outline' },
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  UPCOMING: { label: 'Upcoming', variant: 'secondary' },
}

export function getCoverageStatus(startDate: Date | string, endDate: Date | string): CoverageStatus {
  const now = new Date()
  const start = new Date(startDate)
  const end = new Date(endDate)
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  if (now < start) return 'UPCOMING'
  if (now > end) return 'EXPIRED'
  if (end <= thirtyDaysFromNow) return 'EXPIRING_SOON'
  return 'ACTIVE'
}
