'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { MonitorConfig } from '@/lib/contracts'
import { EditFeedback, useConfigEdit } from '@/components/admin/admin-config'
import { notify } from '@/components/admin/toast'

export function AdminDialog({
  open,
  onClose,
  title,
  variant = 'modal',
  children,
  footer,
  locked = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  variant?: 'modal' | 'drawer'
  children: ReactNode
  footer?: ReactNode
  locked?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`admin-dialog admin-${variant}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!locked && !event.currentTarget.querySelector('[data-busy="true"]')) onClose()
      }}
      onClick={(event) => {
        if (!locked && event.target === event.currentTarget && !event.currentTarget.querySelector('[data-busy="true"]')) onClose()
      }}
    >
      {open && (
        <>
          <header className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-button" disabled={locked} onClick={(event) => {
              if (!event.currentTarget.closest('dialog')?.querySelector('[data-busy="true"]')) onClose()
            }} aria-label="关闭">
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </>
      )}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确定',
  danger = false,
  infoOnly = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmText?: string
  danger?: boolean
  infoOnly?: boolean
  onConfirm?: () => void
  onClose: () => void
}) {
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        infoOnly ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>知道了</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmText}</button>
          </>
        )
      }
    >
      <p className="dialog-message">{message}</p>
    </AdminDialog>
  )
}

export function DeleteConfigDialog({ title, message, version, reload, remove, onSaved, onClose }: {
  title: string
  message: ReactNode
  version: number
  reload: () => Promise<MonitorConfig>
  remove: (version: number) => Promise<MonitorConfig>
  onSaved: (config: MonitorConfig) => void
  onClose: () => void
}) {
  const edit = useConfigEdit(version, reload)

  async function confirm() {
    const config = await edit.save(remove)
    if (config) {
      notify('已删除')
      onSaved(config)
    }
  }

  return (
    <AdminDialog open locked={edit.busy} onClose={onClose} title={title} footer={
      <>
        <button type="button" className="btn" onClick={onClose} disabled={edit.busy}>取消</button>
        <button type="button" className="btn btn-danger" onClick={confirm} disabled={edit.busy || edit.needsReload}>{edit.busy ? '处理中…' : '删除'}</button>
      </>
    }>
      <p className="dialog-message">{message}</p>
      <EditFeedback edit={edit} draft={false} />
    </AdminDialog>
  )
}
