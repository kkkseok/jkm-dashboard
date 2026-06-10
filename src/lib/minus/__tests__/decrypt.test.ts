/**
 * 암호화 .xlsx 복호화 회귀 테스트.
 *
 * 배경: officecrypto-tool(0.0.19)은 agile 암호화의 keyEncryptor 노드를
 * `keyEncryptor['p:encryptedKey']` 로 문자열 하드코딩해 찾는다. 일부 도구는 동일
 * 네임스페이스를 prefix 없이 default namespace 로 선언한 `<encryptedKey xmlns="..."/>`
 * 형태로 EncryptionInfo 를 내보내, 라이브러리가 노드를 못 찾고
 * `Cannot read properties of undefined (reading 'encryptedKeyValue')` 로 죽었다
 * (실파일 예: docs/group/no_mapping_0610.xlsx). parse.ts 가 복호화 전에 XML 을
 * 정규화하도록 고쳤고, 이 테스트가 그 동작을 잠근다.
 *
 * 실데이터(docs/ 는 gitignore) 의존을 피하려고, 테스트가 직접 평문 xlsx 를 만들어
 * 암호화한 뒤 prefix 를 떼어내 0610 과 같은 변종을 합성한다.
 */
import { Buffer } from 'node:buffer'
import officeCrypto from 'officecrypto-tool'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { decryptWorkbookBuffer } from '../parse'

// xlsx 가 번들한 CFB — Node ESM 에선 named export 로 안 잡혀 default 경유가 필요.
const CFB = (
  XLSX as unknown as {
    CFB?: typeof import('xlsx').CFB
    default?: { CFB?: typeof import('xlsx').CFB }
  }
).CFB ?? (XLSX as unknown as { default?: { CFB?: typeof import('xlsx').CFB } }).default?.CFB

const PASSWORD = '1111'

/** 평문 xlsx ArrayBuffer 한 개 생성. */
function makePlainXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['주문번호', '금액'],
    ['A001', 1000],
    ['A002', 2000],
  ])
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
}

/**
 * 정상(p: prefix) 암호화 파일을 prefix 없는 default-namespace 변종으로 변환.
 * parse.ts 의 normalizeAgileEncryptionInfo 정확히 반대 작업 — 0610 케이스를 합성한다.
 */
function stripEncryptedKeyPrefix(encrypted: Uint8Array): Uint8Array {
  const cfb = CFB!.read(encrypted, { type: 'buffer' })
  const ei = CFB!.find(cfb, '/EncryptionInfo')!
  const content = Uint8Array.from(ei.content as ArrayLike<number>)
  const header = content.subarray(0, 8)
  const xml = new TextDecoder()
    .decode(content.subarray(8))
    .replace(/<(\/?)p:encryptedKey([\s/>])/g, '<$1encryptedKey$2')
  const body = new TextEncoder().encode(xml)
  const newContent = new Uint8Array(8 + body.length)
  newContent.set(header, 0)
  newContent.set(body, 8)
  CFB!.utils.cfb_add(cfb, '/EncryptionInfo', newContent)
  return CFB!.write(cfb, { type: 'buffer' }) as Uint8Array
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

function isPkZip(u8: Uint8Array): boolean {
  return u8[0] === 0x50 && u8[1] === 0x4b // 'PK'
}

describe('암호화 .xlsx — keyEncryptor 네임스페이스 표기 정규화', () => {
  const plain = makePlainXlsx()

  it('p: prefix 정상 파일은 복호화된다(기준 동작)', async () => {
    const enc = Uint8Array.from(officeCrypto.encrypt(Buffer.from(plain), { password: PASSWORD }))
    const out = new Uint8Array(await decryptWorkbookBuffer(toArrayBuffer(enc)))
    expect(isPkZip(out)).toBe(true)
  })

  it('prefix 없는 <encryptedKey> 변종도 복호화된다 (회귀: no_mapping_0610)', async () => {
    const enc = Uint8Array.from(officeCrypto.encrypt(Buffer.from(plain), { password: PASSWORD }))
    const variant = stripEncryptedKeyPrefix(enc)

    // 전제 확인: 정규화 없이는 officecrypto-tool 이 파싱 단계에서 죽는다.
    await expect(
      officeCrypto.decrypt(variant as unknown as Buffer, { password: PASSWORD }),
    ).rejects.toThrow()

    // parse.ts 의 정규화를 거치면 정상 복호화되고, 평문과 동일하게 복원된다.
    const out = new Uint8Array(await decryptWorkbookBuffer(toArrayBuffer(variant)))
    expect(isPkZip(out)).toBe(true)
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true)
  })

  it('비암호(PK) 파일은 그대로 통과한다', async () => {
    const out = new Uint8Array(await decryptWorkbookBuffer(toArrayBuffer(plain)))
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true)
  })
})
