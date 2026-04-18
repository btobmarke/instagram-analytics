import Link from 'next/link'

export default function ProposalTemplatesHubPage() {
  const cards = [
    {
      href: '/proposal-templates/wires-parts',
      title: 'ワイヤー / パーツ登録',
      desc: 'HTML ファイルでワイヤー・パーツを登録し、タグで整理します。',
    },
    {
      href: '/proposal-templates/slides',
      title: 'スライド登録',
      desc: '登録済みのワイヤー1件とパーツ複数を組み合わせてスライド定義を作ります。',
    },
    {
      href: '/proposal-templates/designs',
      title: 'デザインテンプレート登録',
      desc: 'スライド定義を並べて、Instagram 提案資料で使うデザインテンプレートにします。',
    },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">テンプレート管理</h1>
        <p className="text-sm text-gray-500 mt-1">
          提案資料（案A・HTML）で利用するワイヤー・パーツ・スライド・デザインを登録します。各画面のタグは独立しています。
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-1">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href}
              className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:border-purple-200 hover:bg-purple-50/40 transition-colors"
            >
              <h2 className="text-lg font-semibold text-gray-900">{c.title}</h2>
              <p className="text-sm text-gray-600 mt-2">{c.desc}</p>
              <span className="inline-block mt-3 text-sm font-medium text-purple-700">開く →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
