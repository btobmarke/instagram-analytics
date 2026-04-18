import { describe, it, expect } from 'vitest'
import { parseFollowerUsernamesFromPaste } from './parse-follower-usernames-from-paste'

describe('parseFollowerUsernamesFromPaste', () => {
  it('removes middle-dot-only lines and picks usernames from alternating pairs', () => {
    const text = `shinyaz326
·
Shinya Tahara
abubozhaoabu
·
阿部 博昭`
    expect(parseFollowerUsernamesFromPaste(text)).toEqual(['shinyaz326', 'abubozhaoabu'])
  })

  it('handles missing middle-dot between username and display', () => {
    const text = `chukasoba.arata
おダシと銀しゃり
takashi_ikada
·
筏 隆志`
    expect(parseFollowerUsernamesFromPaste(text)).toEqual(['chukasoba.arata', 'takashi_ikada'])
  })

  it('skips junk line before username (profile photo caption)', () => {
    const text = `m_icsoftのプロフィール写真
m_icsoft
hasunota
·
安田蓮`
    expect(parseFollowerUsernamesFromPaste(text)).toEqual(['m_icsoft', 'hasunota'])
  })

  it('dedupes case-insensitively', () => {
    const text = `UserOne
·
Display Alpha
userone
·
Display Beta`
    expect(parseFollowerUsernamesFromPaste(text)).toEqual(['userone'])
  })
})
