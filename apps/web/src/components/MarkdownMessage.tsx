import { Fragment } from 'react'

type MarkdownBlock =
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bulletList'; items: string[] }
  | { type: 'numberedList'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }

function isTableLine(line: string) {
  return line.trim().startsWith('|') && line.trim().endsWith('|')
}

function isTableSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isBlockStart(line: string) {
  const trimmed = line.trim()
  return (
    /^#{2,4}\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    isTableLine(trimmed)
  )
}

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const rawLine = lines[index]
    const line = rawLine.trim()

    if (!line) {
      index += 1
      continue
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(heading[1].length, 4) as 2 | 3 | 4,
        text: heading[2].trim(),
      })
      index += 1
      continue
    }

    if (isTableLine(line)) {
      const tableLines: string[] = []
      while (index < lines.length && isTableLine(lines[index])) {
        tableLines.push(lines[index])
        index += 1
      }

      const meaningfulRows = tableLines.filter((tableLine) => !isTableSeparator(tableLine))
      if (meaningfulRows.length >= 2) {
        const [headerLine, ...rowLines] = meaningfulRows
        const headers = splitTableRow(headerLine)
        const rows = rowLines.map(splitTableRow)
        blocks.push({ type: 'table', headers, rows })
      } else if (meaningfulRows.length === 1) {
        blocks.push({ type: 'paragraph', text: splitTableRow(meaningfulRows[0]).join(' · ') })
      }
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, '').trim())
        index += 1
      }
      blocks.push({ type: 'bulletList', items })
      continue
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, '').trim())
        index += 1
      }
      blocks.push({ type: 'numberedList', items })
      continue
    }

    const paragraphLines: string[] = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
  }

  return blocks
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)

  return parts.map((part, index) => {
    if (!part) return null

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-slate-50">
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={index} className="text-slate-300">
          {part.slice(1, -1)}
        </em>
      )
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded-md border border-slate-600 bg-slate-950/60 px-1.5 py-0.5 text-[0.82em] text-cyan-200"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    return <Fragment key={index}>{part}</Fragment>
  })
}

type MarkdownMessageProps = {
  content: string
  streaming?: boolean
  emptyLabel?: string
}

export default function MarkdownMessage({
  content,
  streaming = false,
  emptyLabel = 'Menganalisis data dashboard…',
}: MarkdownMessageProps) {
  const blocks = parseMarkdown(content)

  if (!content && streaming) {
    return <span className="animate-pulse text-slate-400">{emptyLabel}</span>
  }

  return (
    <div className="space-y-4 text-[0.93rem] leading-7 text-slate-200">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const className =
            block.level === 2
              ? 'pt-1 text-base font-semibold text-slate-50'
              : 'pt-1 text-sm font-semibold uppercase tracking-wide text-indigo-200'
          return (
            <h4 key={index} className={className}>
              {renderInline(block.text)}
            </h4>
          )
        }

        if (block.type === 'paragraph') {
          return (
            <p key={index} className="text-slate-200">
              {renderInline(block.text)}
            </p>
          )
        }

        if (block.type === 'bulletList') {
          return (
            <ul key={index} className="space-y-2 pl-1">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2 text-slate-200">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-300" />
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          )
        }

        if (block.type === 'numberedList') {
          return (
            <ol key={index} className="space-y-2">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-3 text-slate-200">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-indigo-100">
                    {itemIndex + 1}
                  </span>
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ol>
          )
        }

        return (
          <div key={index} className="overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-950/30">
            <table className="min-w-full divide-y divide-slate-700 text-left text-sm">
              <thead className="bg-slate-800/80 text-xs uppercase tracking-wide text-slate-300">
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th key={headerIndex} className="whitespace-nowrap px-4 py-3 font-semibold">
                      {renderInline(header)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="align-top odd:bg-slate-900/30 even:bg-slate-900/10">
                    {block.headers.map((_, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-3 text-slate-200">
                        {renderInline(row[cellIndex] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {streaming && <span className="ml-0.5 animate-pulse text-indigo-400">▍</span>}
    </div>
  )
}
