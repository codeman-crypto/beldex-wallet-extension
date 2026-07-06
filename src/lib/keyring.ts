// Encrypted vault: PBKDF2-SHA256 (600k iterations) -> AES-256-GCM via WebCrypto.
// Runs in the background service worker; plaintext secrets exist only in memory
// while unlocked. Consider argon2-browser (WASM) as a stronger KDF later.

export interface Vault {
  v: 1
  kdf: { name: 'PBKDF2'; iterations: number; salt: string }
  iv: string
  ciphertext: string
}

const ITERATIONS = 600_000

const b64 = {
  enc: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptVault(plaintext: string, password: string): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITERATIONS)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext))
  return {
    v: 1,
    kdf: { name: 'PBKDF2', iterations: ITERATIONS, salt: b64.enc(salt.buffer) },
    iv: b64.enc(iv.buffer),
    ciphertext: b64.enc(ct)
  }
}

export async function decryptVault(vault: Vault, password: string): Promise<string> {
  const key = await deriveKey(password, b64.dec(vault.kdf.salt), vault.kdf.iterations)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64.dec(vault.iv) as BufferSource },
    key,
    b64.dec(vault.ciphertext) as BufferSource
  )
  return new TextDecoder().decode(pt)
}
