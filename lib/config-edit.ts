import type { MonitorConfig } from '@/lib/contracts'
import { MonitorRequestError } from '@/lib/monitor-client'

export function createConfigEdit(initialVersion: number) {
  let version = initialVersion
  let conflict: MonitorRequestError | undefined

  return {
    get version() { return version },
    get needsReload() { return conflict !== undefined },
    async save(write: (version: number) => Promise<MonitorConfig>) {
      if (conflict) throw conflict
      try {
        const result = await write(version)
        version = result.version
        return result
      } catch (error) {
        if (error instanceof MonitorRequestError && error.code === 'version_conflict') conflict = error
        throw error
      }
    },
    async reload(read: () => Promise<MonitorConfig>) {
      const result = await read()
      version = result.version
      conflict = undefined
      return result
    },
  }
}

export function createConfigId(prefix: 'r' | 'p'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
