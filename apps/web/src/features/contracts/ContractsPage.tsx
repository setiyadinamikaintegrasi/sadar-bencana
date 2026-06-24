import { useCallback, useEffect, useState } from 'react'
import {
  getContracts,
  deleteContract,
  type AcceptanceContract,
  type ContractFilters,
} from '../../lib/api/client'
import { PERIL_LABELS, formatIDRCompact } from './format'
import ContractFormModal from './ContractFormModal'
import ImportModal from './ImportModal'

const PERIL_OPTIONS = ['', 'earthquake', 'flood', 'volcano', 'fire', 'windstorm', 'other']

export default function ContractsPage() {
  const [rows, setRows] = useState<AcceptanceContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ContractFilters>({})
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AcceptanceContract | undefined>(undefined)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getContracts({ ...filters, limit: 500 })
      setRows(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat kontrak.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Hapus kontrak ini?')) return
      await deleteContract(id)
      void load()
    },
    [load],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-slate-50">Kontrak Akseptasi</h3>
            <p className="mt-2 text-sm text-slate-400">
              Portofolio objek risiko per kontrak akseptasi — premi, TSI, share, dan klaim.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700">
              {rows.length} kontrak
            </span>
            <button
              type="button"
              onClick={() => { setEditing(undefined); setFormOpen(true) }}
              className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-200"
            >
              + Kontrak
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"
            >
              Import CSV
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <select
            value={filters.peril ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, peril: e.target.value || undefined }))}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            {PERIL_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p === '' ? 'Semua peril' : PERIL_LABELS[p]}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Cari no. kontrak / objek…"
            value={filters.q ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>
      </section>

      {loading ? (
        <p className="px-2 text-sm text-slate-400">Memuat…</p>
      ) : error ? (
        <p className="px-2 text-sm text-rose-300">{error}</p>
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead>
                <tr className="text-slate-400">
                  <th className="pb-3 pr-4 font-medium">No. Kontrak</th>
                  <th className="pb-3 pr-4 font-medium">Objek / Cedant</th>
                  <th className="pb-3 pr-4 font-medium">Peril</th>
                  <th className="pb-3 pr-4 font-medium">TSI</th>
                  <th className="pb-3 pr-4 font-medium">Share</th>
                  <th className="pb-3 pr-4 font-medium">Premi</th>
                  <th className="pb-3 pr-4 font-medium">Klaim</th>
                  <th className="pb-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="text-slate-200">
                    <td className="py-3 pr-4 font-medium text-slate-100">{r.contract_no}</td>
                    <td className="py-3 pr-4">
                      <p className="text-slate-100">{r.object_name}</p>
                      <p className="text-xs text-slate-500">{r.cedant_name}</p>
                    </td>
                    <td className="py-3 pr-4">{PERIL_LABELS[r.peril]}</td>
                    <td className="py-3 pr-4">{formatIDRCompact(r.sum_insured, r.currency)}</td>
                    <td className="py-3 pr-4">
                      {formatIDRCompact(r.share_amount, r.currency)}
                      <span className="ml-1 text-xs text-slate-500">({r.share_pct}%)</span>
                    </td>
                    <td className="py-3 pr-4">{formatIDRCompact(r.premium, r.currency)}</td>
                    <td className="py-3 pr-4">{formatIDRCompact(r.claim_amount, r.currency)}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => { setEditing(r); setFormOpen(true) }}
                        className="mr-3 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {formOpen && (
        <ContractFormModal
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void load() }}
        />
      )}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); void load() }}
        />
      )}
    </div>
  )
}
