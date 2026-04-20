export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}
