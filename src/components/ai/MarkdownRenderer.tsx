import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * LLM が表の行区切りを改行ではなく `||` 連結で出すことがある。コードフェンス外だけ補正する。
 */
function normalizeCollapsedMarkdownTables(md: string): string {
  const parts = md.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part
      return part.replace(/^.+$/gm, (line) => {
        const pipes = line.match(/\|/g)?.length ?? 0
        if (pipes < 6 || !line.includes('||')) return line
        return line.replace(/\|\s*\|\s*/g, '|\n|')
      })
    })
    .join('')
}

/**
 * Typography プラグインの `prose` でベースを当て、コード・表だけ上書きする。
 * フェンス付きコードは <pre><code> のため、pre に枠を付け code は素のままにして二重ボックスを防ぐ。
 * GFM 表は remark-gfm でパースする。
 */
export function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null
  const source = normalizeCollapsedMarkdownTables(content)
  return (
    <div className="prose prose-sm max-w-none text-gray-800 prose-headings:text-gray-900 prose-strong:text-gray-900 prose-li:marker:text-gray-400">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className)
            if (!isBlock) {
              return (
                <code
                  className="rounded bg-gray-100 px-1 py-0.5 text-[0.875em] font-mono text-gray-800 before:content-none after:content-none"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className={`${className ?? ''} text-sm font-mono`} {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-4 overflow-x-auto rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm not-prose">
              {children}
            </pre>
          ),
          table: ({ children, ...props }) => (
            <div className="not-prose my-4 w-full overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full border-collapse text-left text-sm text-gray-800" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => <thead {...props}>{children}</thead>,
          tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
          tr: ({ children, ...props }) => <tr {...props}>{children}</tr>,
          th: ({ children, ...props }) => (
            <th
              className="border border-gray-200 bg-gray-50 px-3 py-2 font-semibold text-gray-900"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-gray-200 px-3 py-2 align-top" {...props}>
              {children}
            </td>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}

function BlinkingCursor() {
  return (
    <span
      className="inline-block w-2 h-4 ml-0.5 bg-purple-500 animate-pulse align-middle"
      aria-hidden
    />
  )
}

export { BlinkingCursor }
