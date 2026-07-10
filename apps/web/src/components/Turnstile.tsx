import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

export type TurnstileHandle = { reset: () => void }

type TurnstileProps = {
  siteKey: string
  onVerify: (token: string) => void
  onExpire?: () => void
}

const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { siteKey, onVerify, onExpire },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let pollId: ReturnType<typeof setInterval> | undefined

    const mount = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: onVerify,
        'expired-callback': onExpire,
      })
    }

    if (window.turnstile) {
      mount()
    } else {
      pollId = setInterval(() => {
        if (window.turnstile) {
          clearInterval(pollId)
          mount()
        }
      }, 100)
    }

    return () => {
      cancelled = true
      if (pollId) clearInterval(pollId)
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
    }
  }, [siteKey, onVerify, onExpire])

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current)
    },
  }))

  return <div ref={containerRef} />
})

export default Turnstile
