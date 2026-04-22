export type VendorRecord = {
  id: string
  name: string
  openBalance: number
  oldestBillDate: string
  billCount: number
  overdueCount: number
}

export type OpenBillRow = {
  id: string
  billNo: string
  billDate: string
  dueDate: string
  description: string
  original: number
  amountPaid: number
  openBalance: number
  credits: number
  /** Payments already posted on this bill (for next payment # preview). */
  priorPaymentCount: number
}

export type PaymentHistoryLine = {
  batchId: string
  paymentNo: string
  date: string
  billNoPaid: string
  billDate: string
  billAmount: number
  paymentAmount: number
  remaining: number
  method: string
  account: string
  checkNo: string
  memo: string
  qboStatus: string
  /** Same batch as previous row → blue group border on row. */
  groupContinuation: boolean
}

export const MOCK_VENDORS: VendorRecord[] = [
  {
    id: 'v1',
    name: 'Freightliner of Dallas',
    openBalance: 4280.5,
    oldestBillDate: '2025-01-14',
    billCount: 6,
    overdueCount: 2,
  },
  {
    id: 'v2',
    name: 'TA Petro Stopping Centers',
    openBalance: 0,
    oldestBillDate: '2025-11-02',
    billCount: 3,
    overdueCount: 0,
  },
  {
    id: 'v3',
    name: 'Goodyear Commercial',
    openBalance: 1822.0,
    oldestBillDate: '2025-03-22',
    billCount: 4,
    overdueCount: 1,
  },
]

const billsByVendor: Record<string, OpenBillRow[]> = {
  v1: [
    {
      id: 'b1',
      billNo: '1500',
      billDate: '2025-01-14',
      dueDate: '2025-02-13',
      description: 'Engine diagnostic & labor',
      original: 2400,
      amountPaid: 900,
      openBalance: 1500,
      credits: 0,
      priorPaymentCount: 1,
    },
    {
      id: 'b2',
      billNo: 'INS-JAN',
      billDate: '2025-02-01',
      dueDate: '2026-04-18',
      description: 'Insurance premium — January',
      original: 890,
      amountPaid: 0,
      openBalance: 890,
      credits: 0,
      priorPaymentCount: 0,
    },
    {
      id: 'b3',
      billNo: '1642',
      billDate: '2025-11-20',
      dueDate: '2025-12-20',
      description: 'Parts — air dryer kit',
      original: 1200.5,
      amountPaid: 310,
      openBalance: 890.5,
      credits: 0,
      priorPaymentCount: 0,
    },
  ],
  v2: [
    {
      id: 'b4',
      billNo: 'TA-88421',
      billDate: '2025-11-02',
      dueDate: '2026-04-25',
      description: 'Fuel card settlement',
      original: 410,
      amountPaid: 410,
      openBalance: 0,
      credits: 0,
      priorPaymentCount: 1,
    },
  ],
  v3: [
    {
      id: 'b5',
      billNo: 'GY-9921',
      billDate: '2025-03-22',
      dueDate: '2025-04-21',
      description: 'Drive tires (position steer)',
      original: 2200,
      amountPaid: 378,
      openBalance: 1822,
      credits: 0,
      priorPaymentCount: 0,
    },
  ],
}

const historyByVendor: Record<string, PaymentHistoryLine[]> = {
  v1: [
    {
      batchId: 'pay-batch-1',
      paymentNo: '1500',
      date: '2025-03-01',
      billNoPaid: '1500',
      billDate: '2025-01-14',
      billAmount: 2400,
      paymentAmount: 900,
      remaining: 1500,
      method: 'Check',
      account: 'Operating · 1020',
      checkNo: '4821',
      memo: 'Partial — engine work',
      qboStatus: 'Synced',
      groupContinuation: false,
    },
    {
      batchId: 'pay-batch-2',
      paymentNo: '1642',
      date: '2025-12-04',
      billNoPaid: '1642',
      billDate: '2025-11-20',
      billAmount: 1200.5,
      paymentAmount: 310,
      remaining: 890.5,
      method: 'ACH',
      account: 'Operating · 1020',
      checkNo: '—',
      memo: 'Parts partial',
      qboStatus: 'Synced',
      groupContinuation: false,
    },
    {
      batchId: 'pay-batch-3',
      paymentNo: '1500-1',
      date: '2026-01-10',
      billNoPaid: '1500',
      billDate: '2025-01-14',
      billAmount: 2400,
      paymentAmount: 400,
      remaining: 1100,
      method: 'Check',
      account: 'Operating · 1020',
      checkNo: '5100',
      memo: 'Second installment',
      qboStatus: 'Pending',
      groupContinuation: false,
    },
    {
      batchId: 'pay-batch-4',
      paymentNo: '1642-1',
      date: '2026-01-10',
      billNoPaid: '1642',
      billDate: '2025-11-20',
      billAmount: 1200.5,
      paymentAmount: 200,
      remaining: 690.5,
      method: 'Check',
      account: 'Operating · 1020',
      checkNo: '5100',
      memo: 'Batch check — multi',
      qboStatus: 'Pending',
      groupContinuation: false,
    },
    {
      batchId: 'pay-batch-4',
      paymentNo: 'INS-JAN',
      date: '2026-01-10',
      billNoPaid: 'INS-JAN',
      billDate: '2025-02-01',
      billAmount: 890,
      paymentAmount: 150,
      remaining: 740,
      method: 'Check',
      account: 'Operating · 1020',
      checkNo: '5100',
      memo: 'Batch check — multi',
      qboStatus: 'Pending',
      groupContinuation: true,
    },
  ],
  v2: [],
  v3: [
    {
      batchId: 'pay-gy-1',
      paymentNo: 'GY-9921',
      date: '2025-10-01',
      billNoPaid: 'GY-9921',
      billDate: '2025-03-22',
      billAmount: 2200,
      paymentAmount: 378,
      remaining: 1822,
      method: 'Card',
      account: 'Fuel & maint card',
      checkNo: '—',
      memo: 'Autopay partial',
      qboStatus: 'Synced',
      groupContinuation: false,
    },
  ],
}

export function getOpenBills(vendorId: string): OpenBillRow[] {
  return billsByVendor[vendorId] ?? []
}

export function getPaymentHistory(vendorId: string): PaymentHistoryLine[] {
  return historyByVendor[vendorId] ?? []
}

export function searchVendors(q: string): VendorRecord[] {
  const s = q.trim().toLowerCase()
  if (!s) return MOCK_VENDORS
  return MOCK_VENDORS.filter((v) => v.name.toLowerCase().includes(s))
}
