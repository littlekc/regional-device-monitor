'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function AdminDialog({
  open,
  onClose,
  title,
  variant = 'modal',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  variant?: 'modal' | 'drawer'
  children: ReactNode
  footer?: ReactNode
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
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      {open && (
        <>
          <header className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
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
