import { useEffect, useState } from 'react'
import { fetchServiceTypes } from '../lib/serviceCatalogApi'
import type { ServiceRecordType, ServiceTypeRow } from '../types/serviceCatalog'

/**
 * Loads service types from `/api/catalog/service-types` (run `npm run dev:api` with Vite).
 */
export function useServiceCatalogRows(recordType: ServiceRecordType | 'all') {
  const [rows, setRows] = useState<ServiceTypeRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    void fetchServiceTypes({ recordType })
      .then((list) => {
        if (!cancelled) setRows(list)
      })
      .catch((e) => {
        if (!cancelled) {
          setRows([])
          setError(
            (e as Error)?.message ||
              'Catalog unavailable (start API: npm run dev:api).',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [recordType])

  return { rows, error }
}
