import { useEffect, useState } from 'react'
import { searchCatalogParties } from '../lib/accountingDedupApi'
import type { ComboOption } from '../components/maintenance/SearchableCombo'

/** Live vendor list from `/api/accounting/parties/search` (QBO-backed catalog). */
export function useVendorComboOptions() {
  const [options, setOptions] = useState<ComboOption[]>([])

  useEffect(() => {
    let cancelled = false
    void searchCatalogParties('vendor', '')
      .then(({ parties }) => {
        if (!cancelled) {
          setOptions(parties.map((p) => ({ value: p.id, label: p.name })))
        }
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return options
}
