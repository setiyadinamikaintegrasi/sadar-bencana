import { useState } from 'react'
import { importContracts, type ImportResult } from '../../lib/api/client'

type Props = { onClose: () => void; onImported: () => void }

export default function ImportModal({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setResult(null)
    const res = await importContracts(file)
    setResult(res)
    setBusy(false)
    if (res.data && res.data.failed === 0) {
      onImported()
    }
  }

  const errors = result?.data?.errors ?? result?.errors ?? []

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h3 className="text-lg font-semibold text-slate-50">Import CSV</h3>
        <p className="mt-1 text-sm text-slate-400">
          Mode all-or-nothing: jika ada baris invalid, tidak ada baris yang tersimpan.{' '}
          <a href="/api/v1/contracts/import/template" className="text-indigo-300">
            Unduh template
          </a>
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-4 block w-full text-sm text-slate-300"
        />
        {result?.data && result.data.failed === 0 && (
          <p className="mt-3 text-sm text-emerald-300">
            Berhasil mengimpor {result.data.inserted} kontrak.
          </p>
        )}
        {(result?.error || errors.length > 0) && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            <p className="font-semibold">{result?.message ?? 'Import gagal — tidak ada baris tersimpan.'}</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e, i) => (
                <li key={i}>Baris {e.row}: {e.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300">
            Tutup
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="rounded-xl border border-indigo-400 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-200 disabled:opacity-60"
          >
            {busy ? 'Mengimpor…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
