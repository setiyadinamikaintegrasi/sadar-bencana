import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

/**
 * S12b — Player HLS CCTV langsung dari server resmi (Jasa Marga,
 * Hutama Karya, Dishub). Safari/Edge pakai native; Chrome/Firefox
 * memakai hls.js. Graceful: gagal memuat → pesan + tautan langsung.
 */

/**
 * Validasi stream publik: protokol HTTPS + hostname bukan alamat
 * lokal/pribadi (anti SSRF). Semua stream berasal dari katalog resmi
 * BPJT (bpjt.pu.go.id) — 30+ server publik BUJT (Jasa Marga, Hutama
 * Karya pub2.hk-opt.com, Waskita cctv.waskitabumiwira.com, dll.),
 * sehingga whitelist manual per-host tidak praktis.
 */
function isTrustedStream(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    const hostname = parsed.hostname.toLowerCase()
    // Blokir alamat lokal/pribadi/loopback (anti SSRF).
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname.endsWith('.internal')
      || /^127\./.test(hostname)
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
      || /^169\.254\./.test(hostname)
      || hostname === '0.0.0.0'
      || hostname === '[::1]'
    ) return false
    // Harus punya dot (bukan hostname kosong/tunggal).
    if (!hostname.includes('.')) return false
    return true
  } catch {
    return false
  }
}

export function CctvStreamPlayer({ streamUrl, label }: { streamUrl: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return

    const trusted = isTrustedStream(streamUrl)
    if (!trusted) {
      setStatus('error')
      return
    }

    setStatus('loading')
    let hls: Hls | null = null

    const canPlayNative = video.canPlayType('application/vnd.apple.mpegurl') !== ''
    if (canPlayNative) {
      video.src = streamUrl
      video.addEventListener('loadedmetadata', () => setStatus('ready'), { once: true })
      video.addEventListener('error', () => setStatus('error'), { once: true })
      void video.play().catch(() => setStatus('error'))
    } else if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 15 })
      hls.loadSource(streamUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus('ready')
        void video.play().catch(() => setStatus('error'))
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setStatus('error')
      })
    } else {
      setStatus('error')
    }

    return () => {
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [streamUrl])

  if (status === 'error') {
    return (
      <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-center text-xs text-rose-200">
        <p>Stream tidak dapat dimuat dari perangkat ini.</p>
        <a
          href={streamUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-semibold text-rose-100 underline"
        >
          Buka stream langsung ↗
        </a>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay={false}
        controls
        aria-label={label}
        className="h-40 w-full object-cover"
      />
      {status === 'loading' ? (
        <p className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-slate-300">
          Memuat stream CCTV…
        </p>
      ) : null}
    </div>
  )
}
