import Link from 'next/link'
import { ManualPage, Section } from './_components/ManualPage'

const CARDS = [
  {
    title: '画面別マニュアル',
    desc: 'サイドメニューに並ぶ各画面（クライアント／プロジェクト／バッチ管理／設定）の使い方をまとめています。',
    href: '/manual/screens/clients',
    emoji: '🖥️',
    color: 'from-purple-100 to-pink-100',
  },
  {
    title: 'サービス詳細 機能解説',
    desc: 'プロジェクト配下で登録する各サービス（Instagram・LP・LINE・GBP・Google広告・売上・サマリー）ごとの画面と機能を解説します。',
    href: '/manual/services',
    emoji: '🧩',
    color: 'from-blue-100 to-indigo-100',
  },
  {
    title: '媒体別 設定取得ガイド',
    desc: 'サービス詳細にある「設定／連携」機能で入力する ID・トークン・JSON などを、どの媒体のどこで取得するかを媒体別にまとめています。',
    href: '/manual/integrations',
    emoji: '🔑',
    color: 'from-emerald-100 to-teal-100',
  },
  {
    title: '媒体別 バッチスケジュール',
    desc: 'どの媒体のバッチが何時に起動し、何のデータを取得しているかを媒体別に一覧化しています。',
    href: '/manual/batches',
    emoji: '⏱️',
    color: 'from-amber-100 to-orange-100',
  },
]

export default function ManualIndexPage() {
  return (
    <ManualPage
      title="マニュアル"
      description="本システムの使い方・各画面の機能・媒体ごとの連携設定およびバッチの仕様を、運用担当者向けにまとめたドキュメントです。左のメニューから該当のページを選択してください。"
    >
      <Section title="このマニュアルの構成">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CARDS.map(c => (
            <Link
              key={c.href}
              href={c.href}
              className="group block border border-gray-200 rounded-2xl p-4 hover:border-purple-300 hover:shadow-md transition"
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center text-xl mb-3`}>
                {c.emoji}
              </div>
              <p className="text-sm font-semibold text-gray-900 group-hover:text-purple-700">{c.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed mt-1">{c.desc}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="読み方のヒント">
        <ul className="list-disc pl-5 space-y-1">
          <li>まずは「画面別マニュアル」で各画面の役割を把握してください。</li>
          <li>サービスを新規登録したい場合は「サービス詳細 機能解説」→「媒体別 設定取得ガイド」の順で読むとスムーズです。</li>
          <li>データが取得できない・更新されないといった問い合わせを受けた場合は「媒体別 バッチスケジュール」で該当媒体の実行タイミングを確認してください。</li>
        </ul>
      </Section>
    </ManualPage>
  )
}
