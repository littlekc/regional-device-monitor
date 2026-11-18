'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import type { CatalogItem, CatalogPage } from '@/lib/contracts'
import { requestErrorMessage } from '@/lib/monitor-client'
import { formatSampleTime } from '@/lib/monitor-data'

type CatalogState<T> = { query: string; page?: CatalogPage<T>; error?: string }

export function CatalogPicker<T extends { id: string; name: string }>({
  id, label, selected, multiple, initialQuery = '', fetchPage, onResults, onSelect, describe, include,
}: {
  id: string
  label: string
  selected: string[]
  multiple?: boolean
  initialQuery?: string
  fetchPage: (query: string, signal: AbortSignal) => Promise<CatalogPage<T>>
  onResults?: (results: T[]) => void
  onSelect: (entry: T) => void
  describe: (entry: T) => ReactNode
  include?: (entry: T) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(initialQuery)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CatalogState<T>>()
  const q = query.trim()

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void fetchPage(q, controller.signal).then((page) => {
        if (controller.signal.aborted) return
        setState({ query: q, page })
        onResults?.(page.results)
      }).catch((error) => {
        if (!controller.signal.aborted) setState({ query: q, error: requestErrorMessage(error) })
      })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, q, attempt, fetchPage, onResults])

  const current = state?.query === q ? state : undefined
  const results = current?.page?.results.filter((entry) => include?.(entry) ?? true) ?? []

  return (
    <details id={id} className="catalog-picker" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{label}{selected.length > 0 && <span className="mono cell-muted"> · {selected.length > 3 ? `${selected.length} 项` : selected.join(', ')}</span>}</summary>
      {open && (
        <div className="catalog-results">
          <label className="input-with-icon">
            <Search size={14} aria-hidden="true" />
            <input type="search" maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`搜索${label}`} placeholder="按名称、键或 ID 搜索" />
          </label>
          {!current && <p className="field-hint" role="status">正在查询 Zabbix…</p>}
          {current?.error && (
            <div className="edit-feedback">
              <p className="field-error" role="alert">{current.error}</p>
              <button type="button" className="btn btn-outline" onClick={() => { setState(undefined); setAttempt((value) => value + 1) }}>重试</button>
            </div>
          )}
          {current?.page && (
            <>
              {results.length === 0 && <p className="field-hint">未找到可选结果</p>}
              <div className="item-choices" role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
                {results.map((entry) => (
                  <label className={`item-choice ${selected.includes(entry.id) ? 'is-selected' : ''}`} key={entry.id}>
                    <input type={multiple ? 'checkbox' : 'radio'} name={id} checked={selected.includes(entry.id)} onChange={() => onSelect(entry)} />
                    <span className="item-main"><b>{entry.name}</b>{describe(entry)}</span>
                  </label>
                ))}
              </div>
              {current.page.hasMore && <p className="field-hint">还有其他结果，请缩小搜索范围。</p>}
            </>
          )}
        </div>
      )}
    </details>
  )
}

export function describeCatalogItem(item: CatalogItem) {
  const sample = item.lastClock > 0 && item.lastValue !== '' ? item.lastValue : '无采样'
  return (
    <>
      <span className="catalog-meta mono" title={item.key}>{item.id} · {item.key}{item.units ? ` · ${item.units}` : ''}</span>
      <span className="catalog-meta">
        {sample}{sample !== '无采样' && item.units ? ` ${item.units}` : ''}
        {item.lastClock > 0 && ` · ${formatSampleTime(item.lastClock * 1000)}`}
        {item.status !== '0' ? ' · 已停用' : item.state !== '0' ? ' · 不受支持' : ''}
        {item.effectiveIntervalSeconds !== undefined && ` · 周期 ${item.effectiveIntervalSeconds} 秒`}
      </span>
    </>
  )
}
