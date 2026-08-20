// Coverage for src/lib/signMessage.ts — the message signer that backs
// bdx_signMessage / bdx_verifyMessage.
//
// The WASM core cannot sign messages (see bdx-web3js/docs/PHASE4_CAPABILITY_REPORT.md),
// so this is the only implementation in the extension. It must agree, byte for
// byte, with crypto::check_signature in the core: a signature this produces is
// verified by beldex-wallet-cli's `verify_value` and by the explorer's
// independent Python implementation.
//
// The check_signature cases below come from tests/crypto/tests.txt in the core
// repo — the same vectors the C++ crypto unit tests use. A subset is embedded so
// this runs anywhere; point BELDEX_CRYPTO_TESTS at the full file for all 512:
//
//   BELDEX_CRYPTO_TESTS=../beldex/tests/crypto/tests.txt npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  signMessage, verifyMessage, checkSignature, base58Encode, base58Decode,
  hexToBytes, bytesToHex, addressSpendKey
} from '../src/lib/signMessage.ts'
import { ed25519 } from '@noble/curves/ed25519'

// (hash, pubkey, signature, expected)
const VECTORS = [
  ['57fd3427123988a99aae02ce20312b61a88a39692f3462769947467c6e4c3961',
   'a5e61831eb296ad2b18e4b4b00ec0ff160e30b2834f8d1eda4f28d9656a2ec75',
   'cd89c4cbb1697ebc641e77fdcd843ff9b2feaf37cfeee078045ef1bb8f0efe0b' +
   'b5fd0131fbc314121d9c19e046aea55140165441941906a757e574b8b775c008', true],
  ['92c1259cddde43602eeac1ab825dc12ffc915c9cfe57abcca04c8405df338359',
   '9fa6c7fd338517c7d45b3693fbc91d4a28cd8cc226c4217f3e2694ae89a6f3dc',
   'b027582f0d05bacb3ebe4e5f12a8a9d65e987cc1e99b759dca3fee84289efa51' +
   '24ad37550b985ed4f2db0ab6f44d2ebbc195a7123fd39441d3a57e0f70ecf608', false],
  ['f8628174b471912e7b51aceecd9373d22824065cee93ff899968819213d338c3',
   '8a7d608934a96ae5f1f141f8aa45a2f0ba5819ad668b22d6a12ad6e366bbc467',
   'd7e827fbc168a81b401be58c919b7bcf2d7934fe10da6082970a1eb9d98ca609' +
   'c660855ae5617aeed466c5fd832daa405ee83aef69f0c2661bfa7edf91ca6201', true]
]

// A deterministic test keypair (never a real wallet key).
const SEC_INT = ed25519.CURVE.n - 12345n
const PUB = bytesToHex(ed25519.ExtendedPoint.BASE.multiply(SEC_INT).toRawBytes())
const SEC = bytesToHex(new Uint8Array(32).map((_, i) => Number((SEC_INT >> BigInt(8 * i)) & 0xffn)))
const MSG = 'beldex-asset-owner|v1|56e4bae7df73d7ce|1786950846|b0249c5b|129a6d58fbbd3cb5c02a'

test('check_signature matches the core crypto vectors', () => {
  let vectors = VECTORS
  const path = process.env.BELDEX_CRYPTO_TESTS
  if (path) {
    vectors = readFileSync(path, 'utf8').split('\n')
      .filter(l => l.startsWith('check_signature '))
      .map(l => { const [, h, p, s, e] = l.split(' '); return [h, p, s, e === 'true'] })
    assert.ok(vectors.length > 0, 'no vectors parsed from ' + path)
  }
  for (const [h, pub, sig, expected] of vectors) {
    assert.equal(checkSignature(hexToBytes(h), hexToBytes(pub), hexToBytes(sig)), expected, h)
  }
})

test('check_signature rejects malformed inputs', () => {
  assert.equal(checkSignature(new Uint8Array(31), new Uint8Array(32), new Uint8Array(64)), false)
  assert.equal(checkSignature(new Uint8Array(32), new Uint8Array(32), new Uint8Array(63)), false)
  // all-zero pubkey is not a valid curve point
  assert.equal(checkSignature(new Uint8Array(32), new Uint8Array(32), new Uint8Array(64)), false)
})

test('monero base58 round-trips', () => {
  for (const len of [0, 1, 7, 8, 9, 64, 69]) {
    const data = new Uint8Array(len).map((_, i) => (i * 37) & 0xff)
    assert.equal(bytesToHex(base58Decode(base58Encode(data))), bytesToHex(data))
  }
  assert.throws(() => base58Decode('0OIl'))
})

test('signMessage produces a SigV1 signature that verifies', () => {
  const { signature, pubkey } = signMessage(MSG, SEC, PUB)
  assert.ok(signature.startsWith('SigV1'))
  assert.equal(base58Decode(signature.slice(5)).length, 64)
  assert.equal(pubkey, PUB)
  assert.equal(verifyMessage(MSG, PUB, signature), true)
})

test('signatures are bound to the message and the key', () => {
  const { signature } = signMessage(MSG, SEC, PUB)
  assert.equal(verifyMessage(MSG + 'x', PUB, signature), false)
  const other = bytesToHex(ed25519.ExtendedPoint.BASE.multiply(7n).toRawBytes())
  assert.equal(verifyMessage(MSG, other, signature), false)
})

test('each signature uses a fresh nonce', () => {
  const a = signMessage(MSG, SEC, PUB).signature
  const b = signMessage(MSG, SEC, PUB).signature
  assert.notEqual(a, b) // reusing k would leak the spend key
  assert.equal(verifyMessage(MSG, PUB, a), true)
  assert.equal(verifyMessage(MSG, PUB, b), true)
})

test('a mismatched key pair is refused before signing', () => {
  const wrongPub = bytesToHex(ed25519.ExtendedPoint.BASE.multiply(9n).toRawBytes())
  assert.throws(() => signMessage(MSG, SEC, wrongPub), /mismatch/)
})

test('verifyMessage rejects junk instead of throwing', () => {
  for (const bad of ['', 'nonsense', 'SigV1!!!', 'SigV2' + 'a'.repeat(88)]) {
    assert.equal(verifyMessage(MSG, PUB, bad), false)
  }
})

test('addressSpendKey decodes a real wallet address', () => {
  // Produced by beldex-wallet-cli; its spend key is the value `sign_value`
  // signatures from that wallet verify against.
  const addr = '9vudUCJcsCW1gNhERJKdWVRD8e1TyJPVY295XMuQNiZnAe4oU7F5vgF3' +
               'Ueo7gDCyc6h6UYGSbTiPZFt7CcoF1ymaUhXR9es'
  assert.equal(addressSpendKey(addr),
    '62b806dd4aabcb040f03f3a4485bde90bcb611ea9d357706cfb055365c086939')
  assert.equal(addressSpendKey('not-an-address'), null)
  assert.equal(addressSpendKey(addr.slice(0, -1) + 'X'), null) // checksum guard
})

test('verifies a signature produced by beldex-wallet-cli', () => {
  // Ground truth from a real `sign_value` run. The CLI splits commands on
  // spaces without stripping quotes, so a quoted invocation signs the quotes
  // too — this fixture is the quoted form, and must verify as such.
  const addr = '9vudUCJcsCW1gNhERJKdWVRD8e1TyJPVY295XMuQNiZnAe4oU7F5vgF3' +
               'Ueo7gDCyc6h6UYGSbTiPZFt7CcoF1ymaUhXR9es'
  const sig = 'SigV18njAqA6BoPdfpP2QxkLEqDTb36uuSMU3m1fjFZL12cTtfppHSg92b8kf7a2' +
              'srWNYS1D2JWeT4d2MA7JoRQwwzbiu'
  const value = 'beldex-asset-ownership|v1|56e4bae7df73d7ce0881d214032536cad34bf515e0ed670c524188dd9cc540fa' +
                '|62b806dd4aabcb04|1786948487|8b008a9dc5cf31ca|490b37a671a2ac25c3aa088c9592f287'
  const spend = addressSpendKey(addr)
  assert.equal(verifyMessage('"' + value + '"', spend, sig), true)
  assert.equal(verifyMessage(value, spend, sig), false)
})
