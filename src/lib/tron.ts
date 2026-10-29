import { createHash } from 'crypto'

// ─── Tron / TRC20 helpers for payment verification ──────────────────
// Pure functions (no network) so they can be unit-tested.
//
// Tron address = Base58Check( 0x41 + 20 bytes ), where the 4-byte checksum is the
// first 4 bytes of SHA256(SHA256(payload)). Node RPC (TronGrid) returns addresses as
// 21-byte hex ("41…"); Tronscan returns the Base58 form. Everything is normalised to
// lowercase 21-byte hex before comparing.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest()

export function base58checkEncode(payload: Buffer): string {
  const checksum = sha256(sha256(payload)).subarray(0, 4)
  const full = Buffer.concat([payload, checksum])
  let num = BigInt('0x' + full.toString('hex'))
  let out = ''
  while (num > 0n) {
    out = B58[Number(num % 58n)] + out
    num /= 58n
  }
  for (const byte of full) {
    if (byte === 0) out = '1' + out
    else break
  }
  return out
}

export function base58checkDecode(address: string): Buffer | null {
  let num = 0n
  for (const ch of address) {
    const i = B58.indexOf(ch)
    if (i < 0) return null
    num = num * 58n + BigInt(i)
  }
  let hex = num.toString(16)
  if (hex.length % 2) hex = '0' + hex
  let bytes = Buffer.from(hex, 'hex')
  let zeros = 0
  for (const ch of address) {
    if (ch === '1') zeros++
    else break
  }
  bytes = Buffer.concat([Buffer.alloc(zeros), bytes])
  if (bytes.length < 5) return null
  const payload = bytes.subarray(0, bytes.length - 4)
  const checksum = bytes.subarray(bytes.length - 4)
  const expected = sha256(sha256(payload)).subarray(0, 4)
  return checksum.equals(expected) ? payload : null
}

/** Any Tron address form (Base58 "T…", 21-byte hex "41…", 20-byte hex) → lowercase 21-byte hex, or '' if invalid. */
export function normalizeTronAddress(addr: string | undefined | null): string {
  if (!addr) return ''
  const a = addr.trim()
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) {
    const payload = base58checkDecode(a)
    return payload && payload.length === 21 ? payload.toString('hex') : ''
  }
  const hex = a.replace(/^0x/i, '').toLowerCase()
  if (/^41[0-9a-f]{40}$/.test(hex)) return hex
  if (/^[0-9a-f]{40}$/.test(hex)) return '41' + hex
  return ''
}

export function sameTronAddress(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizeTronAddress(a)
  const nb = normalizeTronAddress(b)
  return !!na && na === nb
}

export function tronHexToBase58(hex21: string): string {
  return base58checkEncode(Buffer.from(hex21, 'hex'))
}

export const TRC20_TRANSFER_SELECTOR = 'a9059cbb' // transfer(address,uint256)

/**
 * Decode the `data` of a TRC20 transfer(address,uint256) call:
 *   4-byte selector | 32-byte recipient (left-padded) | 32-byte amount
 * USDT on Tron has 6 decimals.
 */
export function decodeTrc20TransferData(dataHex: string): { to: string; amount: number } | null {
  const d = (dataHex || '').replace(/^0x/i, '').toLowerCase()
  if (d.length < 8 + 64 + 64) return null
  if (d.slice(0, 8) !== TRC20_TRANSFER_SELECTOR) return null
  const toWord = d.slice(8, 72)
  const amountWord = d.slice(72, 136)
  const to = '41' + toWord.slice(24) // last 20 bytes of the 32-byte word
  const amount = Number(BigInt('0x' + amountWord)) / 1e6
  return { to, amount }
}

export interface ParsedTransfer {
  success: boolean
  amount?: number
  from?: string
  to?: string
  /** tx time in ms (when the source provides it) */
  timestamp?: number
  error?: string
}

/** Parse a TronGrid/Tron-node `gettransactionbyid` response (hex addresses). */
export function parseNodeTransaction(tx: any, wallet: string, usdtContract: string): ParsedTransfer {
  if (!tx || !tx.raw_data) return { success: false, error: 'Transaction not found or not confirmed yet' }
  if (!tx.ret || tx.ret.length === 0 || tx.ret[0].contractRet !== 'SUCCESS') {
    return { success: false, error: 'Transaction not confirmed or failed on-chain' }
  }
  const contract = tx.raw_data.contract?.[0]
  if (!contract || contract.type !== 'TriggerSmartContract') {
    return { success: false, error: 'Not a TRC20 smart contract transaction' }
  }
  const param = contract.parameter?.value
  if (!param) return { success: false, error: 'Invalid transaction parameters' }

  if (!sameTronAddress(param.contract_address, usdtContract)) {
    return { success: false, error: 'Not a USDT transaction' }
  }
  const decoded = decodeTrc20TransferData(param.data || '')
  if (!decoded) return { success: false, error: 'Not a USDT transfer transaction' }
  if (!sameTronAddress(decoded.to, wallet)) {
    return { success: false, error: 'Payment sent to wrong wallet address' }
  }
  return {
    success: true,
    amount: decoded.amount,
    from: normalizeTronAddress(param.owner_address),
    to: decoded.to,
    timestamp: typeof tx.raw_data.timestamp === 'number' ? tx.raw_data.timestamp : undefined,
  }
}

/** Parse a Tronscan `transaction-info` response. */
export function parseTronscanInfo(data: any, wallet: string, usdtContract: string): ParsedTransfer {
  const transfers = data?.trc20TransferInfo as Array<Record<string, any>> | undefined
  if (!transfers || transfers.length === 0) {
    return { success: false, error: 'No TRC20 transfer found in this transaction' }
  }
  if (data.contractRet && data.contractRet !== 'SUCCESS') {
    return { success: false, error: 'Transaction failed on-chain' }
  }
  if (data.confirmed === false) {
    return { success: false, error: 'Transaction is not confirmed yet. Please try again in a minute.' }
  }
  for (const t of transfers) {
    // Tronscan uses snake_case (to_address / contract_address); older shapes used camelCase.
    const to = t.to_address ?? t.to ?? t.toAddress
    const from = t.from_address ?? t.from ?? t.fromAddress
    const contractAddr = t.contract_address ?? t.contractAddress
    const raw = t.amount_str ?? t.value ?? '0'
    if (sameTronAddress(contractAddr, usdtContract) && sameTronAddress(to, wallet)) {
      const decimals = parseInt(String(t.decimals ?? '6'), 10)
      const amount = Number(raw) / Math.pow(10, isNaN(decimals) ? 6 : decimals)
      return {
        success: true,
        amount,
        from: normalizeTronAddress(from),
        to: normalizeTronAddress(to),
        timestamp: typeof data.timestamp === 'number' ? data.timestamp : undefined,
      }
    }
  }
  return { success: false, error: 'No USDT transfer to the correct wallet found' }
}
