import { describe, expect, it } from 'vitest'
import {
  ipv4MatchesAnyCidr,
  ipv4ToUint,
  normalizeLpMaIpExcludeList,
  parseIpv4Cidr,
} from './lp-ip-exclude'

describe('ipv4ToUint', () => {
  it('parses valid IPv4', () => {
    expect(ipv4ToUint('0.0.0.0')).toBe(0)
    expect(ipv4ToUint('255.255.255.255')).toBe(0xffffffff >>> 0)
    expect(ipv4ToUint('203.0.113.1')).toBe(((203 << 24) | (0 << 16) | (113 << 8) | 1) >>> 0)
  })

  it('rejects invalid', () => {
    expect(ipv4ToUint('256.0.0.1')).toBeNull()
    expect(ipv4ToUint('::1')).toBeNull()
    expect(ipv4ToUint('')).toBeNull()
  })
})

describe('parseIpv4Cidr', () => {
  it('normalizes network address', () => {
    expect(parseIpv4Cidr('10.1.2.3/24')?.normalized).toBe('10.1.2.0/24')
    expect(parseIpv4Cidr('192.168.0.15/28')?.normalized).toBe('192.168.0.0/28')
  })

  it('defaults to /32', () => {
    expect(parseIpv4Cidr('8.8.8.8')?.normalized).toBe('8.8.8.8/32')
  })
})

describe('ipv4MatchesAnyCidr', () => {
  it('matches host in range', () => {
    const cidrs = ['10.0.0.0/8']
    expect(ipv4MatchesAnyCidr('10.1.2.3', cidrs)).toBe(true)
    expect(ipv4MatchesAnyCidr('11.0.0.1', cidrs)).toBe(false)
  })

  it('handles IPv6 or unknown IP as no match', () => {
    expect(ipv4MatchesAnyCidr('2001:db8::1', ['0.0.0.0/0'])).toBe(false)
  })
})

describe('normalizeLpMaIpExcludeList', () => {
  it('dedupes and sorts', () => {
    const r = normalizeLpMaIpExcludeList(['10.0.0.1/32', '10.0.0.1/32', '8.8.8.0/24'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cidrs).toEqual(['8.8.8.0/24', '10.0.0.1/32'])
    }
  })

  it('rejects bad entries', () => {
    const r = normalizeLpMaIpExcludeList(['not-a-cidr'])
    expect(r.ok).toBe(false)
  })
})
