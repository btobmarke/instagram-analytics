import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ENCRYPTION_KEY = (process.env.ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY ?? '').padEnd(64, '0').slice(0, 64)

/**
 * アクセストークンをAES-256-CBCで暗号化する
 */
export function encryptToken(token: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * 暗号化されたトークンを復号する
 */
export function decryptToken(encryptedToken: string): string {
  const [ivHex, encryptedHex] = encryptedToken.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

// Aliases for shorter import names
export const encrypt = encryptToken
export const decrypt = decryptToken
