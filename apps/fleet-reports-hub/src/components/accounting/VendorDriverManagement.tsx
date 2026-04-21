import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NameEntityDetail, NameEntityRow } from '../../lib/nameManagementApi'
import {
  fetchNameEntities,
  fetchNameEntityDetail,
  fetchSamsaraDriverPool,
  postApplyRename,
  postDriverLink,
} from '../../lib/nameManagementApi'
import { BulkStandardizeModal } from './BulkStandardizeModal'
import { useColumnResize } from '../../hooks/useColumnResize'
import { useTableTabOrder } from '../../hooks/useTableTabOrder'
import { exportDomTableToXlsx, exportJsonRowsToXlsx } from '../../lib/tableExportXlsx'
import { TableResizeHintFooter } from '../table/TableResizeHintFooter'
import {
  emptyAddress,
  getStoredEntityAddress,
  saveEntityAddress,
  saveVendorAddressByName,
  type VendorCustomerAddress,
} from '../../lib/vendorCustomerAddresses'

type Ent = {
  id: string
  kind: string
  qbo?: { displayName?: string; syncToken?: string; id?: string }
  samsara?: { id?: string; name?: string }
  erp?: { name?: string; refCount?: number; driverId?: string }
}

export function VendorDriverManagement() {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'mismatch' | 'renamed'>('all')
  const [list, setList] = useState<NameEntityRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NameEntityDetail | null>(null)
  const [canonical, setCanonical] = useState('')
  const [updQbo, setUpdQbo] = useState(true)
  const [updSam, setUpdSam] = useState(true)
  const [updErp, setUpdErp] = useState(true)
  const [samPick, setSamPick] = useState('')
  const [samOptions, setSamOptions] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [lastApply, setLastApply] = useState<{
    status: string
    results: Record<string, { status: string; detail: string }>
  } | null>(null)
  const [addr, setAddr] = useState<VendorCustomerAddress>(() => emptyAddress())
  const [bulkOpen, setBulkOpen] = useState(false)
  const sysTableResize = useColumnResize([140, 260, 72])

  const reloadAll = useCallback(async () => {
    setErr(null)
    try {
      const rows = await fetchNameEntities(q, filter)
      setList(rows)
      setSelectedId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev
        return rows[0]?.id ?? null
      })
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }, [q, filter])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  useEffect(() => {
    if (!selectedId) {
      setAddr(emptyAddress())
      setDetail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const d = await fetchNameEntityDetail(selectedId)
        if (cancelled) return
        setDetail(d)
        setAddr(getStoredEntityAddress(selectedId) ?? emptyAddress())
        const ent = d.entity as Ent
        const def =
          ent.qbo?.displayName || ent.samsara?.name || ent.erp?.name || ''
        setCanonical(def)
        setUpdQbo(Boolean(ent.qbo))
        setUpdSam(Boolean(ent.samsara))
        setUpdErp(Boolean(ent.erp))
        setSamPick(ent.samsara?.id || '')
        const opts = await fetchSamsaraDriverPool()
        if (!cancelled) setSamOptions(opts)
      } catch (e) {
        if (!cancelled) setErr(String((e as Error).message || e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const ent = detail?.entity as Ent | undefined

  useTableTabOrder(sysTableResize.tableRef, [detail?.entity?.id])

  const previewLines = useMemo(() => {
    if (!ent || !canonical.trim()) return []
    const lines: string[] = []
    const c = canonical.trim()
    if (updQbo && ent.qbo && ent.qbo.displayName !== c) {
      lines.push(`QBO DisplayName: "${ent.qbo.displayName}" → "${c}" (SyncToken +1)`)
    }
    if (updSam && ent.samsara && ent.samsara.name !== c) {
      lines.push(`Samsara PATCH /fleet/drivers/${ent.samsara.id}: name → "${c}"`)
    }
    if (updErp && ent.erp && ent.erp.name !== c) {
      lines.push(
        `ERP: UPDATE all references (${ent.erp.refCount ?? 0} rows) → "${c}"`,
      )
    }
    if (lines.length === 0) return ['No changes for selected systems (names already match canonical).']
    return lines
  }, [ent, canonical, updQbo, updSam, updErp])

  const apply = async () => {
    if (!ent) return
    setBusy(true)
    setErr(null)
    setLastApply(null)
    try {
      const out = await postApplyRename({
        entityId: ent.id,
        canonical: canonical.trim(),
        updateQbo: updQbo && Boolean(ent.qbo),
        updateSamsara: updSam && Boolean(ent.samsara),
        updateErp: updErp && Boolean(ent.erp),
      })
      setLastApply({ status: out.status || 'unknown', results: out.results || {} })
      await reloadAll()
      const d = await fetchNameEntityDetail(ent.id)
      setDetail(d)
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  const saveDriverLink = async () => {
    if (!ent?.erp?.driverId || !samPick) return
    setBusy(true)
    setErr(null)
    try {
      await postDriverLink(ent.erp.driverId, samPick)
      const d = await fetchNameEntityDetail(ent.id)
      setDetail(d)
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  const statusClass =
    lastApply?.status === 'success'
      ? 'nm-result nm-result--ok'
      : lastApply?.status === 'partial'
        ? 'nm-result nm-result--partial'
        : lastApply?.status === 'fail'
          ? 'nm-result nm-result--fail'
          : 'nm-result'

  const exportRegistryList = () => {
    if (!list.length) return
    const rows = list.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      sources: r.sources.join(', '),
      nameMismatch: r.nameMismatch,
      recentlyRenamed: r.recentlyRenamed,
      lastRenamedAt: r.lastRenamedAt ?? '',
    }))
    const kinds = new Set(list.map((r) => String(r.kind).toLowerCase()))
    const base =
      kinds.size === 1 && kinds.has('driver')
        ? 'DriverList'
        : kinds.size === 1 && kinds.has('vendor')
          ? 'VendorList'
          : kinds.size === 1 && kinds.has('customer')
            ? 'CustomerList'
            : 'NameRegistry'
    exportJsonRowsToXlsx(rows, base, 'Registry')
  }

  return (
    <div className="name-mgmt-page">
      <header className="nm-page__head">
        <div>
          <h3>Vendor & driver registry</h3>
          <p className="muted small">
            Align QBO, Samsara, and ERP display names. Renames log to <code>rename_log</code>; driver
            crosswalks in <code>driver_system_links</code>.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setBulkOpen(true)}>
          Bulk standardize…
        </button>
      </header>

      {err && (
        <div className="nm-banner nm-banner--err" role="alert">
          {err}
        </div>
      )}

      {lastApply && (
        <div className={statusClass}>
          <strong>Last apply:</strong> {lastApply.status.toUpperCase()}
          <ul className="nm-result__list">
            {Object.entries(lastApply.results).map(([k, v]) => (
              <li key={k}>
                <span className="mono">{k}</span>: {v.status} — {v.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="nm-layout">
        <aside className="nm-list">
          <div className="nm-list__filters">
            <label className="field">
              <span>Search</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or id…" />
            </label>
            <label className="field">
              <span>Filter</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
              >
                <option value="all">All</option>
                <option value="mismatch">Has name mismatch</option>
                <option value="renamed">Recently renamed</option>
              </select>
            </label>
            <button
              type="button"
              className="btn sm fr-table-excel-export"
              disabled={!list.length}
              onClick={exportRegistryList}
            >
              Export list to Excel
            </button>
          </div>
          <ul className="nm-list__ul">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={r.id === selectedId ? 'nm-list__btn is-active' : 'nm-list__btn'}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="nm-list__title">{r.label}</span>
                  <span className="nm-list__meta tiny">
                    {r.sources.map((s) => (
                      <span key={s} className={`nm-src nm-src--${s.toLowerCase()}`}>
                        {s}
                      </span>
                    ))}
                    {r.nameMismatch ? (
                      <span className="nm-mismatch-tag">⚠ Name mismatch</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="nm-detail">
          {!detail || !ent ? (
            <p className="muted">Select a record from the list.</p>
          ) : (
            <>
              <h4 className="nm-detail__h">Systems</h4>
              <p className="muted tiny">ERP record count: {detail.erpRefCount}</p>
              <div style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn sm fr-table-excel-export"
                  onClick={() =>
                    exportDomTableToXlsx(sysTableResize.tableRef.current, 'NameMgmtSystems')
                  }
                >
                  Export systems to Excel
                </button>
              </div>
              <table
                ref={sysTableResize.tableRef}
                className="nm-sys-table fr-data-table"
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <thead>
                  <tr>
                    <th
                      className="fr-th-resizable"
                      style={{ width: sysTableResize.widths[0] }}
                    >
                      System
                      <span
                        className="fr-col-resize"
                        role="presentation"
                        onMouseDown={sysTableResize.onResizeMouseDown(0)}
                      />
                    </th>
                    <th
                      className="fr-th-resizable"
                      style={{ width: sysTableResize.widths[1] }}
                    >
                      Name
                      <span
                        className="fr-col-resize"
                        role="presentation"
                        onMouseDown={sysTableResize.onResizeMouseDown(1)}
                      />
                    </th>
                    <th
                      className="fr-th-resizable"
                      style={{ width: sysTableResize.widths[2] }}
                    >
                      {' '}
                      <span
                        className="fr-col-resize"
                        role="presentation"
                        onMouseDown={sysTableResize.onResizeMouseDown(2)}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.systems.map((s) => (
                    <tr key={s.system}>
                      <td>{s.system}</td>
                      <td className={s.aligned === false ? 'nm-sys-warn' : 'nm-sys-ok'}>
                        {s.name ?? '—'}
                      </td>
                      <td className="nm-sys-icon">
                        {s.name == null || s.name === ''
                          ? '—'
                          : s.aligned
                            ? '✓'
                            : '⚠'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TableResizeHintFooter />

              <div className="nm-address-block">
                <h4 className="nm-detail__h">Mailing address (vendor / customer)</h4>
                <p className="muted tiny" style={{ marginBottom: 8 }}>
                  Stored locally for this entity until ERP columns are wired; aligns with migration{' '}
                  <code className="mono">007_vendor_customer_addresses.sql</code>.
                </p>
                <div className="nm-address-grid">
                  <label className="field">
                    <span>Street address</span>
                    <input
                      value={addr.street_address}
                      onChange={(e) => setAddr((a) => ({ ...a, street_address: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>City</span>
                    <input
                      value={addr.city}
                      onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>State</span>
                    <input
                      value={addr.state}
                      onChange={(e) => setAddr((a) => ({ ...a, state: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>ZIP</span>
                    <input
                      value={addr.zip}
                      onChange={(e) => setAddr((a) => ({ ...a, zip: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Country</span>
                    <input
                      value={addr.country}
                      onChange={(e) => setAddr((a) => ({ ...a, country: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Phone</span>
                    <input
                      value={addr.phone ?? ''}
                      onChange={(e) => setAddr((a) => ({ ...a, phone: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input
                      value={addr.email ?? ''}
                      onChange={(e) => setAddr((a) => ({ ...a, email: e.target.value }))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!selectedId}
                  onClick={() => {
                    if (!selectedId) return
                    saveEntityAddress(selectedId, addr)
                    const nm = canonical.trim()
                    if (nm) saveVendorAddressByName(nm, { ...addr, country: addr.country || 'USA' })
                  }}
                >
                  Save address
                </button>
              </div>

              <div className="nm-canonical">
                <label className="field">
                  <span>Canonical name (pre-filled from QBO when present)</span>
                  <input value={canonical} onChange={(e) => setCanonical(e.target.value)} />
                </label>
                <div className="nm-quick-picks">
                  <span className="muted tiny">Quick pick:</span>
                  {ent.qbo?.displayName ? (
                    <button type="button" className="btn sm" onClick={() => setCanonical(ent.qbo!.displayName!)}>
                      QBO
                    </button>
                  ) : null}
                  {ent.samsara?.name ? (
                    <button type="button" className="btn sm" onClick={() => setCanonical(ent.samsara!.name!)}>
                      Samsara
                    </button>
                  ) : null}
                  {ent.erp?.name ? (
                    <button type="button" className="btn sm" onClick={() => setCanonical(ent.erp!.name!)}>
                      ERP
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="nm-checkboxes">
                <label>
                  <input
                    type="checkbox"
                    checked={updQbo}
                    disabled={!ent.qbo}
                    onChange={(e) => setUpdQbo(e.target.checked)}
                  />
                  Update QBO
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={updSam}
                    disabled={!ent.samsara}
                    onChange={(e) => setUpdSam(e.target.checked)}
                  />
                  Update Samsara
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={updErp}
                    disabled={!ent.erp}
                    onChange={(e) => setUpdErp(e.target.checked)}
                  />
                  Update ERP
                </label>
              </div>

              <div className="nm-preview">
                <h4 className="nm-detail__h">Live preview</h4>
                <ul className="nm-preview__ul">
                  {previewLines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>

              <button type="button" className="btn primary" disabled={busy} onClick={() => void apply()}>
                {busy ? 'Applying…' : 'Apply rename'}
              </button>

              {ent.kind === 'driver' && (
                <div className="nm-driver-link">
                  <h4 className="nm-detail__h">Driver system link</h4>
                  {detail.driverLink ? (
                    <p className="muted small">
                      Linked ERP <code>{detail.driverLink.erp_driver_id}</code> ↔ Samsara{' '}
                      <code>{detail.driverLink.samsara_driver_id}</code> ({detail.driverLink.link_type})
                    </p>
                  ) : (
                    <p className="muted small">No link row yet (auto-link runs on list load when fuzzy match passes).</p>
                  )}
                  {detail.needsManualDriverLink ? (
                    <div className="nm-manual-link">
                      <p className="nm-warn-text">
                        Auto-match failed. Pick the Samsara driver to link to this ERP driver and save.
                      </p>
                      <label className="field">
                        <span>Samsara driver</span>
                        <select value={samPick} onChange={(e) => setSamPick(e.target.value)}>
                          <option value="">Select…</option>
                          {samOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name} ({o.id})
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !samPick}
                        onClick={() => void saveDriverLink()}
                      >
                        Save manual link
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <BulkStandardizeModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onApplied={() => {
          void reloadAll()
          if (selectedId) void fetchNameEntityDetail(selectedId).then(setDetail)
        }}
      />
    </div>
  )
}
