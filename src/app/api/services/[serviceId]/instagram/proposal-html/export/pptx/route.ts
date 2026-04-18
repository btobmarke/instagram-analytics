export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { sanitizePdfBasename } from '@/lib/pdf/download-html-as-pdf'

/** 案A: クライアントが html2canvas で生成した PNG（base64 本体のみ）から PPTX を組み立てる */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const resolved = await resolveInstagramAccountIdForService(supabase, serviceId)
  if ('error' in resolved) {
    return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    imagesBase64?: string[]
    filenameBase?: string
  }

  if (!Array.isArray(body.imagesBase64) || body.imagesBase64.length === 0) {
    return NextResponse.json({ success: false, error: 'imagesBase64 が必要です' }, { status: 400 })
  }

  const pptxgen = (await import('pptxgenjs')).default
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_16x9'

  for (const b64 of body.imagesBase64) {
    const slide = pptx.addSlide()
    slide.addImage({
      data: `image/png;base64,${b64}`,
      x: 0,
      y: 0,
      w: 10,
      h: 5.625,
    })
  }

  const buf = await pptx.write({ outputType: 'nodebuffer' })
  const base = sanitizePdfBasename(body.filenameBase?.trim() || 'proposal-html')
  const filename = `${base}.pptx`

  return new NextResponse(Buffer.from(buf as Buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
