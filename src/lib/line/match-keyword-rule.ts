export function keywordMatchesRule(
  messageText: string,
  matchType: 'exact' | 'contains',
  pattern: string,
): boolean {
  const msg = messageText.trim()
  const pat = pattern.trim()
  if (!pat) return false
  if (matchType === 'exact') return msg === pat
  return msg.includes(pat)
}
