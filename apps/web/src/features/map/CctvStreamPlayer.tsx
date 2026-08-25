import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

/**
 * S12b — Player HLS CCTV langsung dari server resmi (Jasa Marga,
 * Hutama Karya, Dishub). Safari/Edge pakai native; Chrome/Firefox
 * memakai hls.js. Graceful: gagal memuat → pesan + tautan langsung.
 */

const ALLOWED_STREAM_HOSTS = [
  'jid.jasamarga.com',
  'jmlive.jasamarga.com',
  'live.banyuwangikab.go.id',
  'cctv.jogjaprov.go.id',
]

function isTrustedStream(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return ALLOWED_STREAM_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
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
