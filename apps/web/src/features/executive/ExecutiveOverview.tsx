const kpis = [
  {
    label: 'Active Events',
    value: '12',
    caption: 'Priority catastrophe events currently under review.',
  },
  {
    label: 'Total Exposure',
    value: '$2.4B',
    caption: 'Estimated gross exposure across monitored regions.',
  },
  {
    label: 'Open Claims',
    value: '37',
    caption: 'Claims requiring active reserve and escalation tracking.',
  },
  {
    label: 'Risk Score Avg',
    value: '68',
    caption: 'Composite risk signal across the current watchlist.',
  },
] as const

const watchlist = [
  {
    event: 'gempa Sulawesi',
    severity: 'High',
    exposure: '$320M',
    status: 'Monitoring',
  },
  {
    event: 'banjir Jateng',
    severity: 'Medium',
    exposure: '$140M',
    status: 'Assessment',
  },
  {
    event: 'erupsi Merapi',
    severity: 'Critical',
    exposure: '$560M',
    status: 'Escalated',
  },
] as const

const severityClasses: Record<(typeof watchlist)[number]['severity'] | 'Low', string> = {
  Low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
  Medium: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
  High: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-400/30',
  Critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
}

export default function ExecutiveOverview() {
  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => (
          <article
            key={item.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{item.label}</p>
            <p className="mt-4 text-4xl font-bold text-slate-50">{item.value}</p>
            <p className="mt-3 text-sm text-slate-400">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">Watchlist</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-50">Priority Event Watchlist</h3>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead>
                <tr className="text-slate-400">
                  <th className="pb-3 pr-6 font-medium">Event</th>
                  <th className="pb-3 pr-6 font-medium">Severity</th>
                  <th className="pb-3 pr-6 font-medium">Exposure</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {watchlist.map((row) => (
                  <tr key={row.event} className="text-slate-200">
                    <td className="py-4 pr-6">{row.event}</td>
                    <td className="py-4 pr-6">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${severityClasses[row.severity]}`}>
                        {row.severity}
                      </span>
                    </td>
                    <td className="py-4 pr-6">{row.exposure}</td>
                    <td className="py-4">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-400">Event Map</p>
          <div className="mt-4 flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800 text-center text-sm text-slate-400">
            Event Map — geo layers coming soon
          </div>
        </div>
      </section>
    </div>
  )
}
