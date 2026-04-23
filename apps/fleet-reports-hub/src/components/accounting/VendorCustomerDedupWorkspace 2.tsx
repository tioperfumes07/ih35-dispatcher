import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { DateFilterBar } from '../DateFilterBar'
import { ResizeTableTh } from '../table/ResizeTableTh'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import type { DateFilterRange } from '../../lib/dateFilterQuickRanges'
import { defaultHistoryDateRange } from '../../lib/dateFilterQuickRanges'
import type { CatalogParty, DedupGroup, EntityType, MergeHistoryRow } from '../../lib/accountingDedupApi'
import {
  fetchAccountingDbStatus,
  fetchDedupCandidates,
  fetchDedupCounts,
  fetchMergeHistory,
  postDedupSkip,
  postMergeExecute,
  searchCatalogParties,
} from '../../lib/accountingDedupApi'

const RULE_HELP: { id: string; label: string }[] = [
  { id: 'exact_name', label: 'Exact name match' },
  { id: 'punctuation_stripped', label: 'Punctuation stripped' },
  { id: 'abbreviations_normalized', label: 'Abbreviations (Inc / LLC / Corp / …)' },
  { id: 'contains_match', label: 'Contains match' },
  { id: 'edit_distance_le_4', label: 'Edit distance ≤ 4' },
  { id: 'same_phone', label: 'Same phone' },
  { id: 'same_email_domain', label: 'Same email domain' },
  { id: 'same_address', label: 'Same address' },
]

type MainTab = 'review' | 'history' | 'manual'

function mergeHistoryRowDate(h: MergeHistoryRow) {
  return h.created_at.slice(0, 10)
}

function normStr(a: unknown, b: unknown) {
  return String(a ?? '')
    .trim()
    .toLowerCase() ===
    String(b ?? '')
      .trim()
      .toLowerCase()
}

function sameField(key: keyof CatalogParty, A: CatalogParty, B: CatalogParty) {
  return normStr(A[key], B[key])
}

function MergeCompareTable({
  A,
  B,
  keepSide,
  onKeepSide,
}: {
  A: CatalogParty
  B: CatalogParty
  keepSide: 'A' | 'B' | null
  onKeepSide: (s: 'A' | 'B') => void
}) {
  const col = useColumnResize([120, 260, 260])
  const fields: { key: keyof CatalogParty; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'address', label: 'Address' },
    { key: 'qboId', label: 'QBO ID' },
    { key: 'billsCount', label: 'Bills' },
    { key: 'expensesCount', label: 'Expenses' },
    { key: 'posCount', label: 'POs' },
  ]

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn sm"
          onClick={() => exportDomTableToXlsx(col.tableRef.current, 'DedupMergeCompare')}
        >
          Export to Excel
        </button>
      </div>
      <table
        ref={col.tableRef}
        className="dedup-merge-table fr-data-table"
        style={{ tableLayout: 'fixed', width: '100%' }}
      >
        <thead>
          <tr>
            <ResizeTableTh colIndex={0} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
              Field
            </ResizeTableTh>
            <ResizeTableTh colIndex={1} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
              <label className="dedup-keep-label">
                <input
                  type="radio"
                  name="keep-side"
                  checked={keepSide === 'A'}
                  onChange={() => onKeepSide('A')}
                />
                <span>Record A (keep)</span>
              </label>
            </ResizeTableTh>
            <ResizeTableTh colIndex={2} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
              <label className="dedup-keep-label">
                <input
                  type="radio"
                  name="keep-side"
                  checked={keepSide === 'B'}
                  onChange={() => onKeepSide('B')}
                />
                <span>Record B (keep)</span>
              </label>
            </ResizeTableTh>
          </tr>
        </thead>
        <tbody>
          {fields.map(({ key, label }) => {
            const same = sameField(key, A, B)
            const cls = same ? 'dedup-cell dedup-cell--same' : 'dedup-cell dedup-cell--diff'
            return (
              <tr key={String(key)}>
                <td className="dedup-merge-table__field">{label}</td>
                <td className={cls}>{String(A[key] ?? '—')}</td>
                <td className={cls}>{String(B[key] ?? '—')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted tiny" style={{ marginTop: 6 }}>
        Drag column edges to resize
      </p>
    </>
  )
}

export function VendorCustomerDedupWorkspace() {
  const histCol = useColumnResize([152, 88, 168, 168, 56, 72])
  const manCol = useColumnResize([220, 120, 200, 96])
  const [mainTab, setMainTab] = useState<MainTab>('review')
  const [entityType, setEntityType] = useState<EntityType>('vendor')
  const [dbOk, setDbOk] = useState<boolean | null>(null)
  const [groups, setGroups] = useState<DedupGroup[]>([])
  const [history, setHistory] = useState<MergeHistoryRow[]>([])
  const [mergeHistoryRange, setMergeHistoryRange] = useState<DateFilterRange>(
    defaultHistoryDateRange,
  )
  const [manualQ, setManualQ] = useState('')
  const [manualRows, setManualRows] = useState<CatalogParty[]>([])
  const [selectedGroup, setSelectedGroup] = useState<DedupGroup | null>(null)
  const [keepSide, setKeepSide] = useState<'A' | 'B' | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmFullScreen, setConfirmFullScreen] = useState(false)
  const confirmDialogRef = useRef<HTMLDivElement | null>(null)
  const confirmReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!confirmOpen) setConfirmFullScreen(false)
  }, [confirmOpen])
  const [confirmAck, setConfirmAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!confirmOpen) {
      const el = confirmReturnFocusRef.current
      if (el && typeof el.focus === 'function') window.setTimeout(() => el.focus(), 0)
      return
    }
    confirmReturnFocusRef.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setConfirmOpen(false)
    }
    const id = window.setTimeout(() => {
      const root = confirmDialogRef.current
      if (!root) return
      const first = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [confirmOpen, busy])

  const refreshCandidates = useCallback(async () => {
    const { groups: g } = await fetchDedupCandidates(entityType)
    setGroups(g)
    setSelectedGroup((prev) => {
      if (!prev) return g[0] ?? null
      const found = g.find((x) => x.groupKey === prev.groupKey)
      return found ?? g[0] ?? null
    })
    setKeepSide(null)
  }, [entityType])

  const refreshHistory = useCallback(async () => {
    const { rows } = await fetchMergeHistory(80)
    setHistory(rows)
  }, [])

  const filteredMergeHistory = useMemo(() => {
    return history.filter((h) => {
      const d = mergeHistoryRowDate(h)
      return d >= mergeHistoryRange.from && d <= mergeHistoryRange.to
    })
  }, [history, mergeHistoryRange])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setErr(null)
      try {
        const [st, counts] = await Promise.all([
          fetchAccountingDbStatus(),
          fetchDedupCounts(),
        ])
        if (cancelled) return
        setDbOk(st.ok)
        setEntityType(
          counts.customerGroupCount > counts.vendorGroupCount ? 'customer' : 'vendor',
        )
      } catch (e) {
        if (!cancelled) {
          setDbOk(false)
          setErr(String((e as Error).message || e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (dbOk !== true) return
    let cancelled = false
    ;(async () => {
      try {
        await refreshCandidates()
        await refreshHistory()
      } catch (e) {
        if (!cancelled) setErr(String((e as Error).message || e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dbOk, entityType, refreshCandidates, refreshHistory])

  useEffect(() => {
    if (mainTab !== 'manual' || dbOk !== true) return
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { parties } = await searchCatalogParties(entityType, manualQ)
          if (!cancelled) setManualRows(parties)
        } catch {
          if (!cancelled) setManualRows([])
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mainTab, manualQ, entityType, dbOk])

  const selectedA = selectedGroup?.recordA
  const selectedB = selectedGroup?.recordB

  const openConfirm = () => {
    if (!selectedGroup || !keepSide) return
    setConfirmAck(false)
    setConfirmOpen(true)
  }

  const runMerge = async () => {
    if (!selectedGroup || !keepSide || !confirmAck) return
    const keep = keepSide === 'A' ? selectedGroup.recordA : selectedGroup.recordB
    const merge = keepSide === 'A' ? selectedGroup.recordB : selectedGroup.recordA
    setBusy(true)
    setErr(null)
    try {
      await postMergeExecute({
        entityType,
        keepId: keep.id,
        mergeId: merge.id,
      })
      setConfirmOpen(false)
      await refreshCandidates()
      await refreshHistory()
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  const skipGroup = async (g: DedupGroup) => {
    setBusy(true)
    setErr(null)
    try {
      await postDedupSkip({
        entityType,
        partyIdA: g.recordA.id,
        partyIdB: g.recordB.id,
        groupKey: g.groupKey,
        reason: 'user_skipped',
      })
      await refreshCandidates()
      if (selectedGroup?.groupKey === g.groupKey) {
        setSelectedGroup(null)
        setKeepSide(null)
      }
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  const bandClass = (band: string) =>
    band === 'HIGH' ? 'dedup-band dedup-band--high' : 'dedup-band dedup-band--med'

  const keepPreview = useMemo(() => {
    if (!selectedGroup || !keepSide) return null
    const k = keepSide === 'A' ? selectedGroup.recordA : selectedGroup.recordB
    const m = keepSide === 'A' ? selectedGroup.recordB : selectedGroup.recordA
    return { kept: k, merged: m }
  }, [selectedGroup, keepSide])

  return (
    <div className="acct-dedup">
      {err && (
        <div className="acct-dedup__banner acct-dedup__banner--err" role="alert">
          {err}
        </div>
      )}
      {dbOk === false && (
        <div className="acct-dedup__banner acct-dedup__banner--warn">
          API unavailable or SQLite tables missing. Run <code>npm run dev:api</code> and open the
          accounting tab so <code>merge_log</code> / <code>dedup_skipped</code> can be created —
          merges stay disabled until then.
        </div>
      )}

      <div className="acct-dedup__toolbar">
        <div className="acct-dedup__toggle" role="group" aria-label="Vendor or customer">
          <button
            type="button"
            className={entityType === 'vendor' ? 'btn primary sm' : 'btn sm'}
            onClick={() => setEntityType('vendor')}
          >
            Vendors
          </button>
          <button
            type="button"
            className={entityType === 'customer' ? 'btn primary sm' : 'btn sm'}
            onClick={() => setEntityType('customer')}
          >
            Customers
          </button>
        </div>
        <p className="muted small">
          Auto-detect on load picks the list with more duplicate groups (toggle anytime).
        </p>
      </div>

      <div className="integrity-tabs acct-dedup__tabs" role="tablist">
        {(
          [
            ['review', 'Duplicate review'],
            ['history', 'Merge history'],
            ['manual', 'Manual search'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={mainTab === id ? 'integrity-tab active' : 'integrity-tab'}
            onClick={() => setMainTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mainTab === 'review' && (
        <div className="acct-dedup__review">
          <aside className="acct-dedup__group-list">
            <h4 className="acct-dedup__h">Suggested groups</h4>
            <p className="muted tiny">
              HIGH ≥75% · MEDIUM 50–74%. Eight rules: exact name, punctuation stripped, abbreviations,
              contains, edit distance ≤4, same phone, same email domain, same address.
            </p>
            <ul>
              {groups.map((g) => (
                <li key={g.groupKey}>
                  <button
                    type="button"
                    className={
                      selectedGroup?.groupKey === g.groupKey
                        ? 'acct-dedup__group-btn is-active'
                        : 'acct-dedup__group-btn'
                    }
                    onClick={() => {
                      setSelectedGroup(g)
                      setKeepSide(null)
                    }}
                  >
                    <span className={bandClass(g.band)}>{g.band}</span>{' '}
                    <span className="mono tiny">{g.confidencePct}%</span>
                    <span className="acct-dedup__group-names">
                      {g.recordA.name}
                      <span className="muted"> vs </span>
                      {g.recordB.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {groups.length === 0 && <p className="muted small">No open groups (try the other list or reset skips in DB).</p>}
          </aside>

          <section className="acct-dedup__detail">
            {selectedGroup && selectedA && selectedB ? (
              <>
                <div className="acct-dedup__rules">
                  {RULE_HELP.map((r) => (
                    <span
                      key={r.id}
                      className={
                        selectedGroup.rulesMatched.includes(r.id)
                          ? 'dedup-rule dedup-rule--hit'
                          : 'dedup-rule'
                      }
                      title={r.label}
                    >
                      {r.label}
                    </span>
                  ))}
                </div>
                <MergeCompareTable
                  A={selectedA}
                  B={selectedB}
                  keepSide={keepSide}
                  onKeepSide={setKeepSide}
                />
                <div className="acct-dedup__actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!keepSide || dbOk !== true || busy}
                    onClick={() => openConfirm()}
                  >
                    Merge…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void skipGroup(selectedGroup)}
                  >
                    Skip group
                  </button>
                </div>
                <p className="muted tiny">
                  Merge runs only if both parties exist in QBO (demo: <code>qboId</code> present),
                  rate limit <strong>10 merges/hour</strong>, and <code>merge_log</code> /
                  <code>dedup_skipped</code> tables exist. Skip writes to <code>dedup_skipped</code>.
                </p>
              </>
            ) : (
              <p className="muted">Select a group to compare.</p>
            )}
          </section>
        </div>
      )}

      {mainTab === 'history' && (
        <div className="acct-dedup__tablewrap">
          <DateFilterBar
            value={mergeHistoryRange}
            onApply={setMergeHistoryRange}
            recordCount={filteredMergeHistory.length}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                exportDomTableToXlsx(histCol.tableRef.current, 'VendorCustomerDedupHistory')
              }
            >
              Export to Excel
            </button>
          </div>
          <table
            ref={histCol.tableRef}
            className="data-table fr-data-table"
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <thead>
              <tr>
                <ResizeTableTh colIndex={0} widths={histCol.widths} onResizeMouseDown={histCol.onResizeMouseDown}>
                  When
                </ResizeTableTh>
                <ResizeTableTh colIndex={1} widths={histCol.widths} onResizeMouseDown={histCol.onResizeMouseDown}>
                  Type
                </ResizeTableTh>
                <ResizeTableTh colIndex={2} widths={histCol.widths} onResizeMouseDown={histCol.onResizeMouseDown}>
                  Kept
                </ResizeTableTh>
                <ResizeTableTh colIndex={3} widths={histCol.widths} onResizeMouseDown={histCol.onResizeMouseDown}>
                  Merged (renamed)
                </ResizeTableTh>
                <ResizeTableTh colIndex={4} widths={histCol.widths} onResizeMouseDown={histCol.onResizeMouseDown}>
                  %
                </ResizeTableTh>
                <ResizeTableTh colIndex={5} widths={histCol.widths} onResizeMouseDown={histCol.onResizeMouseDown}>
                  QBO
                </ResizeTableTh>
              </tr>
            </thead>
            <tbody>
              {filteredMergeHistory.map((h) => (
                <tr key={h.id}>
                  <td className="mono tiny">{h.created_at.slice(0, 19)}</td>
                  <td>{h.entity_type}</td>
                  <td>{h.kept_name_final}</td>
                  <td>{h.merged_name_final}</td>
                  <td>{h.confidence_pct}</td>
                  <td>{h.qboVerified ? 'OK' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted tiny" style={{ marginTop: 6 }}>
            Drag column edges to resize
          </p>
          {history.length === 0 && <p className="muted small pad">No merges yet.</p>}
          {history.length > 0 && filteredMergeHistory.length === 0 && (
            <p className="muted small pad">No merges in this date range.</p>
          )}
        </div>
      )}

      {mainTab === 'manual' && (
        <div className="acct-dedup__manual">
          <label className="field">
            <span>Search {entityType}s</span>
            <input
              value={manualQ}
              onChange={(e) => setManualQ(e.target.value)}
              placeholder="Name, email, phone…"
            />
          </label>
          <div className="acct-dedup__tablewrap">
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  exportDomTableToXlsx(manCol.tableRef.current, 'VendorCustomerDedupSearch')
                }
              >
                Export to Excel
              </button>
            </div>
            <table
              ref={manCol.tableRef}
              className="data-table fr-data-table"
              style={{ tableLayout: 'fixed', width: '100%' }}
            >
              <thead>
                <tr>
                  <ResizeTableTh colIndex={0} widths={manCol.widths} onResizeMouseDown={manCol.onResizeMouseDown}>
                    Name
                  </ResizeTableTh>
                  <ResizeTableTh colIndex={1} widths={manCol.widths} onResizeMouseDown={manCol.onResizeMouseDown}>
                    Phone
                  </ResizeTableTh>
                  <ResizeTableTh colIndex={2} widths={manCol.widths} onResizeMouseDown={manCol.onResizeMouseDown}>
                    Email
                  </ResizeTableTh>
                  <ResizeTableTh colIndex={3} widths={manCol.widths} onResizeMouseDown={manCol.onResizeMouseDown}>
                    QBO
                  </ResizeTableTh>
                </tr>
              </thead>
              <tbody>
                {manualRows.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="mono tiny">{p.phone ?? '—'}</td>
                    <td className="tiny">{p.email ?? '—'}</td>
                    <td className="mono tiny">{p.qboId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted tiny" style={{ marginTop: 6 }}>
              Drag column edges to resize
            </p>
          </div>
        </div>
      )}

      {confirmOpen && selectedGroup && keepPreview && (
        <div
          className={
            'modal-backdrop' +
            (confirmFullScreen ? ' app-modal-backdrop--fullscreen' : '')
          }
          role="presentation"
          onClick={() => !busy && setConfirmOpen(false)}
        >
          <div
            ref={confirmDialogRef}
            className={
              'modal dedup-confirm' +
              (confirmFullScreen ? ' app-modal-panel--fullscreen' : '')
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="dedup-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-generic-head">
              <h3 id="dedup-confirm-title">Confirm merge</h3>
              <div className="modal-generic-head__actions">
                <ModalFullscreenToggle
                  isFullScreen={confirmFullScreen}
                  onToggle={() => setConfirmFullScreen((v) => !v)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="modal-fs-toggle"
                  onClick={() => setConfirmOpen(false)}
                  disabled={busy}
                  aria-label="Close"
                >
                  <span className="modal-fs-toggle__icon" aria-hidden>
                    ×
                  </span>
                </button>
              </div>
            </header>
            <div className="dedup-confirm__summary">
              <p>
                <strong>Keep:</strong> {keepPreview.kept.name} <span className="muted tiny mono">({keepPreview.kept.id})</span>
              </p>
              <p>
                <strong>Merge into kept:</strong> {keepPreview.merged.name}{' '}
                <span className="muted tiny mono">({keepPreview.merged.id})</span>
              </p>
            </div>
            <div className="dedup-confirm__warn">
              Bills, expenses, and POs will be repointed to the kept {entityType} in QBO (demo: counts
              only). The merged {entityType} is deactivated, <code>[MERGED]</code> is appended to its
              name, ERP rows update, and this action is logged to <code>merge_log</code>.
            </div>
            <label className="dedup-confirm__ack">
              <input
                type="checkbox"
                checked={confirmAck}
                onChange={(e) => setConfirmAck(e.target.checked)}
              />
              <span>I understand this cannot be undone from the UI.</span>
            </label>
            <div className="dedup-confirm__btns">
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn dedup-confirm__merge-btn"
                disabled={!confirmAck || busy}
                onClick={() => void runMerge()}
              >
                {busy ? 'Merging…' : 'Execute merge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
