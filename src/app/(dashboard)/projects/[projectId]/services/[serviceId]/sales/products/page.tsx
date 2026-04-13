'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ServiceDetail {
  id: string
  service_name: string
  project: { id: string; project_name: string }
}

interface Product {
  id: string
  service_id: string
  item_code: string | null
  item_name: string
  unit_price_with_tax: number | null
  unit_price_without_tax: number | null
  tax_rate: number | null
  cost_price: number | null
  has_stock_management: boolean
  stock_quantity: number | null
  sales_start_date: string | null
  sales_end_date: string | null
  is_active: boolean
  created_at: string
}

export default function SalesProductsPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = use(params)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const { data: svcData } = useSWR<{ success: boolean; data: ServiceDetail }>(
    `/api/services/${serviceId}`,
    fetcher
  )
  const service = svcData?.data

  const { data: productsData, mutate } = useSWR<{ success: boolean; data: Product[] }>(
    `/api/services/${serviceId}/sales/products`,
    fetcher
  )
  const allProducts = productsData?.data ?? []
  const products = showInactive ? allProducts : allProducts.filter(p => p.is_active)

  const tabs = [
    { href: `/projects/${projectId}/services/${serviceId}/sales/dashboard`, label: 'ダッシュボード', active: false },
    { href: `/projects/${projectId}/services/${serviceId}/sales/records`, label: '売上登録', active: false },
    { href: `/projects/${projectId}/services/${serviceId}/sales/products`, label: '商品マスタ', active: true },
    { href: `/projects/${projectId}/services/${serviceId}/summary`, label: 'サマリー', active: false },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4 flex-wrap">
        <Link href="/projects" className="hover:text-amber-600">プロジェクト</Link>
        <span>›</span>
        <Link href={`/projects/${projectId}`} className="hover:text-amber-600">
          {service?.project.project_name ?? '...'}
        </Link>
        <span>›</span>
        <Link href={`/projects/${projectId}/services/${serviceId}/sales/dashboard`} className="hover:text-amber-600">
          {service?.service_name ?? '...'}
        </Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">商品マスタ</span>
      </nav>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-yellow-100 flex items-center justify-center text-xl">💰</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">商品マスタ</h1>
          <p className="text-sm text-gray-400">{service?.service_name ?? ''}</p>
        </div>
      </div>

      {/* タブ */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        {tabs.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              tab.active
                ? 'text-amber-600 border-amber-500'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-gray-900">
              商品一覧
              <span className="ml-2 text-sm font-normal text-gray-400">{products.length}件</span>
            </h2>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
                className="rounded"
              />
              無効も表示
            </label>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              商品を追加
            </button>
          )}
        </div>

        {showForm && (
          <div className="px-6 py-5 border-b border-gray-100 bg-amber-50">
            <ProductForm
              serviceId={serviceId}
              onClose={() => setShowForm(false)}
              onSaved={() => { setShowForm(false); mutate() }}
            />
          </div>
        )}

        {products.length === 0 && !showForm ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-sm mb-2">商品が登録されていません</p>
            <button onClick={() => setShowForm(true)} className="text-amber-600 text-sm font-medium hover:underline">
              最初の商品を追加する
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {products.map(product => (
              <div key={product.id}>
                {editingId === product.id ? (
                  <div className="px-6 py-5 bg-amber-50">
                    <ProductForm
                      serviceId={serviceId}
                      existing={product}
                      onClose={() => setEditingId(null)}
                      onSaved={() => { setEditingId(null); mutate() }}
                    />
                  </div>
                ) : (
                  <ProductRow
                    product={product}
                    serviceId={serviceId}
                    onEdit={() => setEditingId(product.id)}
                    onToggleActive={async () => {
                      await fetch(`/api/services/${serviceId}/sales/products?id=${product.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ is_active: !product.is_active }),
                      })
                      mutate()
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- 商品行 ----------
function ProductRow({
  product,
  serviceId,
  onEdit,
  onToggleActive,
}: {
  product: Product
  serviceId: string
  onEdit: () => void
  onToggleActive: () => void
}) {
  return (
    <div className={`px-6 py-4 flex items-start justify-between gap-4 ${!product.is_active ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {product.item_code && (
            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{product.item_code}</span>
          )}
          <span className="text-sm font-semibold text-gray-800">{product.item_name}</span>
          {!product.is_active && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">無効</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
          <span>税込: <strong>{formatCurrency(product.unit_price_with_tax)}</strong></span>
          <span>税抜: {formatCurrency(product.unit_price_without_tax)}</span>
          <span>税率: {formatTaxRate(product.tax_rate)}</span>
          {product.cost_price != null && <span>原価: {formatCurrency(product.cost_price)}</span>}
          {product.has_stock_management && (
            <span className="text-blue-600">在庫: {product.stock_quantity ?? '—'}</span>
          )}
        </div>
        {(product.sales_start_date || product.sales_end_date) && (
          <p className="text-xs text-gray-400 mt-0.5">
            販売期間: {product.sales_start_date ?? '—'} 〜 {product.sales_end_date ?? '—'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onToggleActive}
          className="text-xs text-gray-400 hover:text-amber-600 transition"
        >
          {product.is_active ? '無効化' : '有効化'}
        </button>
        <button onClick={onEdit} className="text-xs text-gray-400 hover:text-blue-600 transition">
          編集
        </button>
      </div>
    </div>
  )
}

// ---------- 商品フォーム ----------
function ProductForm({
  serviceId,
  existing,
  onClose,
  onSaved,
}: {
  serviceId: string
  existing?: Product
  onClose: () => void
  onSaved: () => void
}) {
  const [itemCode, setItemCode]                                 = useState(existing?.item_code ?? '')
  const [itemName, setItemName]                                 = useState(existing?.item_name ?? '')
  const [unitPriceWithTax, setUnitPriceWithTax]                 = useState(existing?.unit_price_with_tax?.toString() ?? '')
  const [unitPriceWithoutTax, setUnitPriceWithoutTax]           = useState(existing?.unit_price_without_tax?.toString() ?? '')
  const [taxRate, setTaxRate]                                   = useState(existing ? String(Math.round((existing.tax_rate ?? 0) * 100)) : '10')
  const [costPrice, setCostPrice]                               = useState(existing?.cost_price?.toString() ?? '')
  const [hasStockManagement, setHasStockManagement]             = useState(existing?.has_stock_management ?? false)
  const [stockQuantity, setStockQuantity]                       = useState(existing?.stock_quantity?.toString() ?? '')
  const [salesStartDate, setSalesStartDate]                     = useState(existing?.sales_start_date ?? '')
  const [salesEndDate, setSalesEndDate]                         = useState(existing?.sales_end_date ?? '')
  const [saving, setSaving]                                     = useState(false)
  const [error, setError]                                       = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!itemName.trim()) { setError('商品名は必須です'); return }

    setSaving(true)
    setError('')

    const payload = {
      item_code: itemCode.trim() || null,
      item_name: itemName.trim(),
      unit_price_with_tax: unitPriceWithTax ? Number(unitPriceWithTax) : null,
      unit_price_without_tax: unitPriceWithoutTax ? Number(unitPriceWithoutTax) : null,
      tax_rate: taxRate ? Number(taxRate) / 100 : null,
      cost_price: costPrice ? Number(costPrice) : null,
      has_stock_management: hasStockManagement,
      stock_quantity: hasStockManagement && stockQuantity ? Number(stockQuantity) : null,
      sales_start_date: salesStartDate || null,
      sales_end_date: salesEndDate || null,
    }

    let res: Response
    if (existing) {
      res = await fetch(`/api/services/${serviceId}/sales/products?id=${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      res = await fetch(`/api/services/${serviceId}/sales/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    const json = await res.json()
    setSaving(false)
    if (!json.success) { setError(json.error?.message ?? '保存に失敗しました'); return }
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm font-semibold text-gray-700">{existing ? '商品を編集' : '商品を追加'}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">商品コード</label>
          <input type="text" value={itemCode} onChange={e => setItemCode(e.target.value)}
            placeholder="例: ITEM-001"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div className="col-span-2 md:col-span-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">商品名 <span className="text-red-500">*</span></label>
          <input type="text" value={itemName} onChange={e => setItemName(e.target.value)}
            placeholder="例: ランチセット"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">販売単価（税込）</label>
          <input type="number" value={unitPriceWithTax} onChange={e => setUnitPriceWithTax(e.target.value)}
            placeholder="例: 1100" min="0"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">販売単価（税抜）</label>
          <input type="number" value={unitPriceWithoutTax} onChange={e => setUnitPriceWithoutTax(e.target.value)}
            placeholder="例: 1000" min="0"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">税率（%）</label>
          <select value={taxRate} onChange={e => setTaxRate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300">
            <option value="10">10%</option>
            <option value="8">8%（軽減税率）</option>
            <option value="0">0%（非課税）</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">原価</label>
          <input type="number" value={costPrice} onChange={e => setCostPrice(e.target.value)}
            placeholder="例: 400" min="0"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">販売開始日</label>
          <input type="date" value={salesStartDate} onChange={e => setSalesStartDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">販売終了日</label>
          <input type="date" value={salesEndDate} onChange={e => setSalesEndDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <div className="col-span-2 flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={hasStockManagement} onChange={e => setHasStockManagement(e.target.checked)}
              className="rounded" />
            <span className="text-sm text-gray-600">在庫管理する</span>
          </label>
        </div>
      </div>

      {hasStockManagement && (
        <div className="max-w-xs">
          <label className="block text-xs font-medium text-gray-600 mb-1">在庫数</label>
          <input type="number" value={stockQuantity} onChange={e => setStockQuantity(e.target.value)}
            placeholder="例: 50" min="0"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
          キャンセル
        </button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-60 transition">
          {saving ? '保存中...' : existing ? '更新' : '追加'}
        </button>
      </div>
    </form>
  )
}

function formatCurrency(v: number | null) {
  if (v == null) return '—'
  return `¥${v.toLocaleString('ja-JP')}`
}

function formatTaxRate(v: number | null) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(0)}%`
}
