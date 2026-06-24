import { useCallback, useRef, useState } from 'react'
import MarkdownMessage from '../../components/MarkdownMessage'
import { streamCopilotChat } from '../../lib/api/client'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

function cleanAssistantContent(content: string) {
  return content
    .replace(/^(Saya\s+(akan|coba|perlu)\s+[^.?!]+[.?!]\s*)/i, '')
    .replace(/^(Saya\s+sudah\s+(cek|memeriksa|melihat|menemukan|mengambil|menganalisis)[^.?!]+[.?!]\s*)/i, '')
    .replace(/^Berdasarkan\s+data\s+yang\s+saya\s+(cek|lihat|temukan)[^.?!]+[.?!]\s*/i, '')
    .replace(/\n\s*(Apakah\s+(Anda|Bapak|Pak Joko)[^?]+\?\s*)$/i, '')
    .replace(/\n\s*(Ada\s+yang\s+ingin\s+ditanyakan\s+lagi\??\s*)$/i, '')
    .replace(/\n\s*(Bila\s+(Anda|Bapak|Pak Joko)[^\n]+saya\s+siap\s+membantu\.?)\s*$/i, '')
    .replace(/\n\s*(Jika\s+(Anda|Bapak|Pak Joko)[^\n]+saya\s+siap\s+membantu\.?)\s*$/i, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const listEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || loading) return

    const userMessage: Message = { role: 'user', content: trimmed }
    setMessages((current) => [...current, userMessage])
    setInput('')
    setLoading(true)

    const assistantMessage: Message = { role: 'assistant', content: '' }
    setMessages((current) => [...current, assistantMessage])

    abortRef.current?.abort()

    const controller = streamCopilotChat(trimmed, {
      onChunk: (text) => {
        setMessages((current) => {
          const last = current[current.length - 1]
          if (last?.role === 'assistant') {
            return [...current.slice(0, -1), { ...last, content: last.content + text }]
          }
          return current
        })
        scrollToBottom()
      },
      onComplete: () => {
        setMessages((current) => {
          const last = current[current.length - 1]
          if (last?.role === 'assistant') {
            return [...current.slice(0, -1), { ...last, content: cleanAssistantContent(last.content) }]
          }
          return current
        })
        setLoading(false)
        abortRef.current = null
        scrollToBottom()
      },
      onError: (err) => {
        setMessages((current) => {
          const last = current[current.length - 1]
          if (last?.role === 'assistant') {
            return [
              ...current.slice(0, -1),
              { ...last, content: `**Error:** ${err.message}` },
            ]
          }
          return [
            ...current,
            { role: 'assistant' as const, content: `**Error:** ${err.message}` },
          ]
        })
        setLoading(false)
        abortRef.current = null
      },
    })

    abortRef.current = controller
  }, [input, loading, scrollToBottom])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
    abortRef.current = null
  }, [])

  const handleClear = useCallback(() => {
    setMessages([])
    setInput('')
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-slate-50">Analyst Copilot</h3>
            <p className="mt-2 text-sm text-slate-400">
              Ajukan pertanyaan tentang event, alert, eksposur, risk score, dan data dashboard lainnya.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600"
          >
            Hapus Chat
          </button>
        </div>
      </section>

      <section className="flex min-h-[400px] flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-slate-950/40">
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="text-center">
              <p className="text-4xl text-slate-600">✦</p>
              <p className="mt-3 text-sm text-slate-500">
                Tanyakan sesuatu tentang dashboard, misalnya:
              </p>
              <ul className="mt-4 space-y-1 text-xs text-slate-500">
                <li>"Apa event dengan magnitude tertinggi hari ini?"</li>
                <li>"Apa dampak dari gempa di Jepang selatan?"</li>
                <li>"Tunjukkan alert yang belum di-acknowledge"</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto p-4 md:p-6">
            {messages.map((msg, idx) => {
              const isAssistant = msg.role === 'assistant'
              const isStreamingLastMessage = loading && idx === messages.length - 1 && isAssistant

              return (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'max-w-[80%] bg-indigo-500/20 text-indigo-100 ring-1 ring-inset ring-indigo-400/30'
                        : 'max-w-[96%] bg-slate-800 text-slate-200 ring-1 ring-inset ring-slate-700 md:max-w-[88%]'
                    }`}
                  >
                    {isAssistant ? (
                      <MarkdownMessage content={msg.content} streaming={isStreamingLastMessage} />
                    ) : (
                      <p>{msg.content}</p>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={listEndRef} />
          </div>
        )}

        <div className="border-t border-slate-800 p-4 md:p-6">
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tanyakan sesuatu tentang data dashboard..."
              rows={2}
              disabled={loading}
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 transition focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-6 py-3 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? '…' : 'Kirim'}
              </button>
              {loading && (
                <>
                  <span className="ml-2 self-center text-xs italic text-slate-500">
                    {messages[messages.length - 1]?.content ? 'Menulis...' : 'Memproses...'}
                  </span>
                  <button
                    type="button"
                    onClick={handleStop}
                    className="inline-flex items-center justify-center rounded-xl border border-rose-500/50 px-4 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/10"
                  >
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Analyst Copilot adalah AI read-only — tidak dapat melakukan perubahan data.
          </p>
        </div>
      </section>
    </div>
  )
}
