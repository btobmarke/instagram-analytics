/**
 * ブラウザ上の DOM を html2canvas + jsPDF で PDF 保存する（クライアント専用）。
 */

export function sanitizePdfBasename(s: string): string {
  const t = s
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
  return t || 'report'
}

export async function downloadHtmlAsPdf(
  element: HTMLElement,
  filenameBase: string
): Promise<void> {
  const html2pdf = (await import('html2pdf.js')).default
  const filename = `${sanitizePdfBasename(filenameBase)}.pdf`

  await html2pdf()
    .set({
      margin: [10, 10, 14, 10],
      filename,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // html2pdf.js のオプション（型定義が追随していないため any で渡す）
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    } as any)
    .from(element)
    .save()
}
