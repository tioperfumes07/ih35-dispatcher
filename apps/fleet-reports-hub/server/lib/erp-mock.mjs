/**
 * Minimal ERP-shaped mock for cross-checks until wired to real DB.
 */
export function minimalErp() {
  const old = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
  return {
    workOrders: [
      {
        id: 'wo-1',
        unit: '101',
        serviceDate: old,
        serviceType: 'PM · lube',
        serviceMileage: 400000,
        maintRecordType: 'pm',
        amount: 420,
        qboSyncStatus: 'pending',
        savedAt: old,
      },
      {
        id: 'wo-2',
        unit: '101',
        serviceDate: new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10),
        serviceType: 'Annual DOT inspection',
        amount: 0,
        qboSyncStatus: 'synced',
      },
    ],
    fuelPurchases: [
      { unit: '101', txnDate: new Date().toISOString().slice(0, 10), gallons: 90, totalCost: 3200 },
    ],
    integrityAlerts: [],
    unitOdometerErp: {
      '101': 420000,
      '102': 198500,
      '204': 305200,
    },
    dispatchStatus: {
      '101': 'In service',
      '102': 'In service',
    },
    erpDriverByUnit: {
      '101': 'Different Driver',
      '102': 'M. Chen',
    },
  };
}
