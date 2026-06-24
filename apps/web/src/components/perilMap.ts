export function eventTypeToPerilClient(eventType: string | null | undefined): string {
  const t = (eventType ?? '').toLowerCase()
  if (t.includes('earthquake') || t.includes('quake')) return 'earthquake'
  if (t.includes('wildfire') || t.includes('fire')) return 'fire'
  if (t.includes('volcano')) return 'volcano'
  if (t.includes('flood')) return 'flood'
  if (t.includes('storm') || t.includes('cyclone') || t.includes('wind')) return 'windstorm'
  return 'other'
}
