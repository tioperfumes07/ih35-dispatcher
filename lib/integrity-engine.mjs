
    maxMonthlyCostPerUnit: 4000,
    maxServiceRecordsPerUnit60d: 6,
      if (nRep > th.maxRepairsPerDriver90d) {
      if (nAcc > th.maxAccidentsPerDriver12mo) {
        if (svcCount > th.maxServiceRecordsPerUnit60d) {
  { key: 'maxRepairsPerDriver90d', label: 'Repairs / driver / 90d — alert when count exceeds this', unitLabel: 'count' },
  { key: 'maxAccidentsPerDriver12mo', label: 'Accidents / driver / 12mo — alert when count exceeds this', unitLabel: 'count' },
  { key: 'maxServiceRecordsPerUnit60d', label: 'Service records / unit / 60d — alert when count exceeds this', unitLabel: 'count' },