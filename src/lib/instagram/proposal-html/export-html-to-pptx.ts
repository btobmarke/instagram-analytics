/**
 * 案A: プレビュー DOM → html2canvas → サーバ API で PPTX 化（クライアント側）
 */
import html2canvas from 'html2canvas'
import { sanitizePdfBasename } from '@/lib/pdf/download-html-as-pdf'

export async function exportHtmlSlideElementsToPptx(
  serviceId: string,
  elements: (HTMLElement | null | undefined)[],
  filenameBase: string,
): Promise<void> {
  const valid = elements.filter((e): e is HTMLElement => e != null)
  if (valid.length === 0) throw new Error('スライド要素がありません')

  const imagesBase64: string[] = []
  for (const el of valid) {
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    })
    const dataUrl = canvas.toDataURL('image/png')
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    imagesBase64.push(b64)
  }

  const res = await fetch(`/api/services/${serviceId}/instagram/proposal-html/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imagesBase64,
      filenameBase: sanitizePdfBasename(filenameBase),
    }),
  })

  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(typeof j.error === 'string' ? j.error : 'PPTX の生成に失敗しました')
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizePdfBasename(filenameBase)}.pptx`
  a.click()
  URL.revokeObjectURL(url)
}
