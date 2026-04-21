
   * @property {string} [driverErpId]
    if (mrt === 'accident' && !String(s.driverErpId || '').trim()) {
      pushErr('apErpDriverSearch', 'ap_acc_driver', 'Driver is required for accident maintenance bills/expenses.');
    }