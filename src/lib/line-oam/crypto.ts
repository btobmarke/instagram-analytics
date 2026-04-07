// ============================================================
// LINE OAM セッション暗号化ユーティリティ
//
// ・KEK ラップ: AES-256-CBC（既存 crypto.ts の encrypt/decrypt を流用）
// ・storage_state 復号: PBKDF2-HMAC-SHA256 + AES-256-GCM
//   → 仕様書 §3 / Python cryptography.hazmat AESGCM と互換
// ============================================================

import { createDecipheriv, pbkdf2Sync } from 'crypto'
import { encrypt as encryptCBC, decrypt as decryptCBC } from '@/lib/utils/crypto'

export interface KdfParams {
  name:       string   // "PBKDF2"
  hash:       string   // "SHA-256"
  iterations: number
  salt_b64:   string
}

export interface LineOamSessionRecord {
  kdf:                  KdfParams
  nonce_b64:            string
  ciphertext_b64:       string          // AES-256-GCM 暗号文 + 16byte 認証タグ
  encrypted_passphrase: string | null
}

// ----------------------------------------------------------------
// パスフレーズの KEK ラップ / アンラップ
// ----------------------------------------------------------------

/** パスフレーズを KEK(AES-256-CBC) で暗号化してDBに保存する値を生成 */
export function encryptPassphrase(passphrase: string): string {
  return encryptCBC(passphrase)
}

/** DB から取り出した encrypted_passphrase を KEK で復号 */
export function decryptPassphrase(encrypted: string): string {
  return decryptCBC(encrypted)
}

// ----------------------------------------------------------------
// storage_state の復号（PBKDF2 + AES-256-GCM）
// ----------------------------------------------------------------

/**
 * DB に保存された LINE OAM セッションレコードから storage_state JSON 文字列を復号する。
 *
 * Python AESGCM.encrypt / decrypt との互換性:
 *   ciphertext_b64 = base64(AESGCM.encrypt(nonce, plaintext, None))
 *   = base64(ciphertext_bytes + 16-byte auth_tag)
 */
export function decryptStorageState(session: LineOamSessionRecord): string {
  if (!session.encrypted_passphrase) {
    throw new Error(
      'encrypted_passphrase が未設定です。' +
      '無人バッチには初回登録時にパスフレーズをサーバに預ける設定が必要です。'
    )
  }

  // 1. KEK でパスフレーズを復号
  const passphrase = decryptPassphrase(session.encrypted_passphrase)

  // 2. PBKDF2 で 32byte 鍵を導出
  const kdf  = session.kdf
  const salt = Buffer.from(kdf.salt_b64, 'base64')
  const key  = pbkdf2Sync(passphrase, salt, kdf.iterations, 32, 'sha256')

  // 3. AES-256-GCM で復号
  const nonce             = Buffer.from(session.nonce_b64, 'base64')
  const ciphertextWithTag = Buffer.from(session.ciphertext_b64, 'base64')

  // Python AESGCM の出力 = ciphertext_bytes + 16-byte auth_tag
  const authTag    = ciphertextWithTag.slice(-16)
  const ciphertext = ciphertextWithTag.slice(0, -16)

  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf-8')
}

// ----------------------------------------------------------------
// Cookie ヘッダー構築
// ----------------------------------------------------------------

/**
 * Playwright storage_state JSON から Cookie ヘッダー文字列を構築する。
 * LINE OAM への fetch リクエストに使用。
 */
export function buildCookieHeader(storageStateJson: string): string {
  const state = JSON.parse(storageStateJson) as {
    cookies?: Array<{ name: string; value: string }>
  }
  return (state.cookies ?? [])
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
}
