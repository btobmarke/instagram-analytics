export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveInstagramAccountIdForService } from '@/lib/ai/resolve-service-instagram'
import { proposalDeckContentSchema } from '@/lib/instagram/proposal-deck/schema'
import { buildProposalDeckPptxBuffer } from '@/lib/instagram/proposal-deck/build-pptx'
import { sanitizePdfBasename } from '@/lib/pdf/download-html-as-pdf'

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
    deck?: unknown
    filenameBase?: string
    slideIndices?: number[]
  }

  const parsed = proposalDeckContentSchema.safeParse(body.deck)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'deck が不正です' }, { status: 400 })
  }

  let content = parsed.data
  if (Array.isArray(body.slideIndices) && body.slideIndices.length > 0) {
    const idx = new Set(body.slideIndices.filter((i) => Number.isInteger(i) && i >= 0))
    const slides = parsed.data.slides.filter((_, i) => idx.has(i))
    if (slides.length === 0) {
      return NextResponse.json({ success: false, error: '有効なスライド index がありません' }, { status: 400 })
    }
    content = { ...parsed.data, slides }
  }

  const buf = await buildProposalDeckPptxBuffer(content)
  const base = sanitizePdfBasename(body.filenameBase?.trim() || content.documentTitle || 'proposal-deck')
  const filename = `${base}.pptx`

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
