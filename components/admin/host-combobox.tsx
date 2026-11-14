'use client'

import { useId, useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { mockHosts } from '@/lib/zabbix-mock'

export function HostCombobox({ id, value, onChange, invalid, describedBy }: {
  id: string
  value: string
  onChange: (hostId: string) => void
  invalid?: boolean
  describedBy?: string
}) {
  const listId = useId()
  const selected = mockHosts.find((host) => host.id === value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? mockHosts.filter((host) => host.name.toLowerCase().includes(q) || host.ip.includes(q)) : mockHosts
  }, [query])

  function choose(hostId: string) {
    onChange(hostId)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="combobox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <div className={`input-with-icon ${invalid ? 'is-invalid' : ''}`}>
        <Search size={14} aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
          autoComplete="off"
          placeholder={selected ? `${selected.name} · ${selected.ip}` : '搜索主机名称或 IP'}
          value={open ? query : selected ? `${selected.name} · ${selected.ip}` : query}
          onFocus={() => { setOpen(true); setQuery(''); setActive(0) }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((i) => Math.min(results.length - 1, i + 1)) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
            if (event.key === 'Enter' && open && results[active]) {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              choose(results[active].id)
            }
            if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
          }}
        />
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      {open && (
        <ul id={listId} role="listbox" className="combobox-list">
          {results.length === 0 && <li className="combobox-empty">没有匹配的主机</li>}
          {results.map((host, index) => (
            <li
              key={host.id}
              id={`${listId}-${host.id}`}
              role="option"
              aria-selected={host.id === value}
              className={`${index === active ? 'is-active' : ''} ${host.id === value ? 'is-selected' : ''}`}
              onMouseDown={(event) => { event.preventDefault(); choose(host.id) }}
              onMouseEnter={() => setActive(index)}
            >
              <span>{host.name}</span>
              <span className="mono">{host.ip}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
