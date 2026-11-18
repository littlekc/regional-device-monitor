import { isIPv4 } from 'node:net'
import type { CatalogItem } from '../contracts.ts'

export const WAN_ADDRESS_KEY = 'ikuai.full.json[ip_20]'
const addressOid = '1.3.6.1.2.1.4.20.1.1.'
const indexOid = '1.3.6.1.2.1.4.20.1.2.'

/** Join the current complete IP-MIB address table by ifIndex, never by WAN-name guesses. */
export function wanAddresses(status: CatalogItem | undefined, table: CatalogItem): string[] | undefined {
  const index = /^net\.if\.status\[ifOperStatus[.,](\d+)\]$/.exec(status?.key ?? '')?.[1]
  if (!index || status?.hostId !== table.hostId || table.key !== WAN_ADDRESS_KEY || table.valueType !== '4') return
  try {
    const data: unknown = JSON.parse(table.lastValue)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    const entries = data as Record<string, unknown>
    const result = []
    for (const [oid, row] of Object.entries(entries)) {
      if (!oid.startsWith(indexOid) || !Array.isArray(row) || row[1] !== index) continue
      const ip = oid.slice(indexOid.length)
      const address = entries[addressOid + ip]
      if (isIPv4(ip) && ip !== '0.0.0.0' && Array.isArray(address) && address[1] === ip) result.push(ip)
    }
    return [...new Set(result)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  } catch { return }
}
