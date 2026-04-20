import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { assertLineService } from '@/lib/line/assert-line-service'

type Params = { params: Promise<{ serviceId: string }> }

const MAX_CONTACTS = 500
const MAX_TAGS_PER_OP = 50

const BodySchema = z
  .object({
    contact_ids: z.array(z.string().uuid()).min(1).max(MAX_CONTACTS),
    tag_ids_to_add: z.array(z.string().uuid()).max(MAX_TAGS_PER_OP).optional().default([]),
    tag_ids_to_remove: z.array(z.string().uuid()).max(MAX_TAGS_PER_OP).optional().default([]),
  })
  .strict()
  .superRefine((data, ctx) => {
    const add = data.tag_ids_to_add ?? []
    const rem = data.tag_ids_to_remove ?? []
    if (add.length === 0 && rem.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tag_ids_to_add または tag_ids_to_remove のいずれかを指定してください',
        path: ['tag_ids_to_add'],
      })
    }
    const addSet = new Set(add)
    for (const id of rem) {
      if (addSet.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '同一タグを付与と解除の両方に指定できません',
          path: ['tag_ids_to_remove'],
        })
        break
      }
    }
  })

/**
 * POST /api/services/[serviceId]/line-messaging/contacts/bulk-tags
 * 選択したコンタクトに対しタグを一括付与・一括解除（既存タグは単体 PUT とは別にマージ付与）
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { serviceId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertLineService(supabase, serviceId)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const contactIds = [...new Set(parsed.data.contact_ids)]
  const tagIdsToAdd = [...new Set(parsed.data.tag_ids_to_add ?? [])]
  const tagIdsToRemove = [...new Set(parsed.data.tag_ids_to_remove ?? [])]

  const admin = createSupabaseAdminClient()

  const { data: contacts, error: cErr } = await admin
    .from('line_messaging_contacts')
    .select('id')
    .eq('service_id', serviceId)
    .in('id', contactIds)

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if ((contacts ?? []).length !== contactIds.length) {
    return NextResponse.json(
      { error: 'invalid_contact_ids', message: '一部のコンタクト ID が存在しないか別サービスです' },
      { status: 400 },
    )
  }

  const allTagIds = [...new Set([...tagIdsToAdd, ...tagIdsToRemove])]
  if (allTagIds.length) {
    const { data: tags, error: tErr } = await admin
      .from('line_messaging_tags')
      .select('id')
      .eq('service_id', serviceId)
      .in('id', allTagIds)

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if ((tags ?? []).length !== allTagIds.length) {
      return NextResponse.json({ error: 'invalid_tag_id' }, { status: 400 })
    }
  }

  let removed = 0
  if (tagIdsToRemove.length) {
    const { error: delErr, count } = await admin
      .from('line_messaging_contact_tags')
      .delete({ count: 'exact' })
      .in('contact_id', contactIds)
      .in('tag_id', tagIdsToRemove)

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    removed = count ?? 0
  }

  let added = 0
  if (tagIdsToAdd.length) {
    const desired: { contact_id: string; tag_id: string }[] = []
    for (const contact_id of contactIds) {
      for (const tag_id of tagIdsToAdd) {
        desired.push({ contact_id, tag_id })
      }
    }

    const { data: existingRows, error: exErr } = await admin
      .from('line_messaging_contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds)
      .in('tag_id', tagIdsToAdd)

    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

    const existingKey = new Set(
      (existingRows ?? []).map((r) => `${r.contact_id}:${r.tag_id}`),
    )
    const toInsert = desired.filter((r) => !existingKey.has(`${r.contact_id}:${r.tag_id}`))

    const chunkSize = 500
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize)
      const { error: insErr } = await admin.from('line_messaging_contact_tags').insert(chunk)
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
    added = toInsert.length
  }

  return NextResponse.json({
    success: true,
    data: {
      contacts: contactIds.length,
      tag_ids_to_add: tagIdsToAdd.length,
      tag_ids_to_remove: tagIdsToRemove.length,
      links_inserted: added,
      rows_deleted: removed,
    },
  })
}
