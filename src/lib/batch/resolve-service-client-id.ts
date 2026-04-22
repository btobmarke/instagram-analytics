/**
 * `services` を `projects!inner(client_id)` で取得したとき、
 * PostgREST により `projects` がオブジェクトまたは **長さ1の配列**で返ることがある。
 * どちらでも `client_id` を取り出す。
 */
export function resolveClientIdFromServiceJoin(
  svcRow: { projects?: unknown } | null | undefined
): string | null {
  const p = svcRow?.projects
  if (p == null) return null
  if (Array.isArray(p)) {
    const first = p[0] as { client_id?: string } | undefined
    const id = first?.client_id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  if (typeof p === 'object' && p !== null && 'client_id' in p) {
    const id = (p as { client_id?: string }).client_id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  return null
}
