'use client'

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import type { MonitorConfig, MonitorSnapshot } from '@/lib/contracts'
import { createConfigEdit } from '@/lib/config-edit'
import { requestErrorMessage } from '@/lib/monitor-client'
import { useMonitorSnapshot } from '@/components/use-monitor-snapshot'

type AdminConfigState = {
  config: MonitorConfig
  applyConfig: (config: MonitorConfig) => void
  reloadConfig: () => Promise<MonitorConfig>
  signOut: () => void
}

export const AdminConfigContext = createContext<(AdminConfigState & {
  snapshot?: MonitorSnapshot
  snapshotFailed: boolean
}) | null>(null)

export function AdminConfigProvider({ children, ...state }: AdminConfigState & { children: ReactNode }) {
  const { snapshot, failed } = useMonitorSnapshot('/api/admin/snapshot', state.config.version)
  return (
    <AdminConfigContext.Provider value={{ ...state, snapshot, snapshotFailed: failed }}>
      {children}
    </AdminConfigContext.Provider>
  )
}

export function useAdminConfig() {
  const context = useContext(AdminConfigContext)
  if (!context) throw new Error('Missing administrator configuration')
  return context
}

export function ConfigDriftNotice() {
  const { config, snapshot, reloadConfig } = useAdminConfig()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!snapshot || snapshot.version <= config.version) return null

  async function reload() {
    setBusy(true)
    setError('')
    try {
      await reloadConfig()
    } catch (cause) {
      setError(requestErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="edit-feedback">
      <p className="config-drift" role="status">检测到配置更新。读取最新配置后可恢复当前状态和读数。</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="button" className="btn btn-outline" disabled={busy} onClick={reload}>{busy ? '正在读取…' : '读取最新配置'}</button>
    </div>
  )
}

export function useConfigEdit(version: number, reload: () => Promise<MonitorConfig>) {
  const [edit] = useState(() => createConfigEdit(version))
  const admin = useContext(AdminConfigContext)
  const stale = edit.version < Math.max(admin?.config.version ?? 0, admin?.snapshot?.version ?? 0)
  const needsReload = edit.needsReload || stale
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<MonitorConfig>) {
    if (active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      return await action()
    } catch (cause) {
      setError(requestErrorMessage(cause))
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  return {
    busy, error, stale, needsReload,
    async save(write: (baseVersion: number) => Promise<MonitorConfig>) {
      if (!needsReload) return await run(() => edit.save(write))
    },
    reload: () => run(() => edit.reload(reload)),
  }
}

export function EditFeedback({ edit, draft = true }: { edit: ReturnType<typeof useConfigEdit>; draft?: boolean }) {
  if (!edit.error && !edit.needsReload) return null
  return (
    <div className="edit-feedback">
      {edit.stale && <p className="config-drift" role="status">检测到配置更新，请读取最新配置。</p>}
      {edit.error && <p className="field-error" role="alert">{edit.error}</p>}
      {edit.needsReload && (
        <>
          {draft && <p className="field-hint">草稿已保留。重新读取配置后，请确认草稿再保存。再次保存会提交下方完整表单。</p>}
          <button type="button" className="btn btn-outline" disabled={edit.busy} onClick={() => void edit.reload()}>读取最新配置</button>
        </>
      )}
    </div>
  )
}
