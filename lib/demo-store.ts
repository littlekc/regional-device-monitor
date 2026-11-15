'use client'

import { useSyncExternalStore } from 'react'
import {
  createDemoDevices,
  defaultRegions,
  migrateCachedDevices,
  type MonitorDevice,
  type Region,
} from '@/lib/monitor-data'

/**
 * 演示数据访问层：大屏与后台共享同一份状态，保存在 localStorage。
 * 以后接入真实后端时，只需替换 demoApi 中的实现。
 */

export const PALETTE_IDS = ['harbor', 'titanium', 'jade'] as const
export type PaletteId = (typeof PALETTE_IDS)[number]

export type DemoSettings = {
  zabbixUrl: string
  apiToken: string
  refreshSeconds: number
}

export type DemoState = {
  devices: MonitorDevice[]
  regions: Region[]
  settings: DemoSettings
  palette: PaletteId
}

const KEYS = {
  devices: 'region-monitor-demo-data',
  regions: 'region-monitor-regions',
  settings: 'region-monitor-settings',
  palette: 'region-monitor-gauge-palette',
} as const

export const defaultSettings: DemoSettings = {
  zabbixUrl: 'https://zabbix.example.com/api_jsonrpc.php',
  apiToken: 'demo-token-0000-0000-sample',
  refreshSeconds: 10,
}

let state: DemoState | null = null
let rawSnapshot = ''
const listeners = new Set<() => void>()

function readJson<T>(key: string): T | undefined {
  const raw = window.localStorage.getItem(key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function readRaw() {
  return Object.values(KEYS).map((key) => window.localStorage.getItem(key) ?? '').join('\u0000')
}

function load(): DemoState {
  const savedDevices = readJson<MonitorDevice[]>(KEYS.devices)
  const devices = Array.isArray(savedDevices) ? migrateCachedDevices(savedDevices) : createDemoDevices()
  write(KEYS.devices, devices)

  const savedRegions = readJson<Region[]>(KEYS.regions)
  const regions = Array.isArray(savedRegions)
    ? savedRegions.map((region, index) => ({ ...region, order: region.order ?? index + 1 }))
    : defaultRegions
  write(KEYS.regions, regions)

  const settings = { ...defaultSettings, ...readJson<Partial<DemoSettings>>(KEYS.settings) }
  const savedPalette = window.localStorage.getItem(KEYS.palette)
  const palette = PALETTE_IDS.find((id) => id === savedPalette) ?? 'harbor'

  rawSnapshot = readRaw()
  return { devices, regions, settings, palette }
}

function emit() {
  for (const listener of listeners) listener()
}

function update(patch: Partial<DemoState>) {
  const current = getSnapshot()
  state = { ...current, ...patch }
  if (patch.devices) write(KEYS.devices, state.devices)
  if (patch.regions) write(KEYS.regions, state.regions)
  if (patch.settings) write(KEYS.settings, state.settings)
  if (patch.palette) window.localStorage.setItem(KEYS.palette, state.palette)
  rawSnapshot = readRaw()
  emit()
}

/** 重新读取本地存储（其他标签页修改或定时刷新时使用），无变化则不触发渲染。 */
export function syncFromStorage() {
  if (!state || readRaw() === rawSnapshot) return
  state = load()
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (!event.key || (Object.values(KEYS) as string[]).includes(event.key)) syncFromStorage()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): DemoState {
  if (!state) state = load()
  return state
}

function getServerSnapshot(): DemoState | null {
  return null
}

export function useDemoState(): DemoState | null {
  return useSyncExternalStore<DemoState | null>(subscribe, getSnapshot, getServerSnapshot)
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const demoApi = {
  async saveDevice(device: MonitorDevice) {
    const { devices } = getSnapshot()
    const exists = devices.some((item) => item.id === device.id)
    update({ devices: exists ? devices.map((item) => (item.id === device.id ? device : item)) : [...devices, device] })
  },
  async setDeviceHidden(id: string, hidden: boolean) {
    update({ devices: getSnapshot().devices.map((item) => (item.id === id ? { ...item, hidden } : item)) })
  },
  async deleteDevice(id: string) {
    update({ devices: getSnapshot().devices.filter((item) => item.id !== id) })
  },
  async saveRegion(region: Region) {
    const { regions } = getSnapshot()
    const exists = regions.some((item) => item.id === region.id)
    update({ regions: exists ? regions.map((item) => (item.id === region.id ? region : item)) : [...regions, region] })
  },
  async deleteRegion(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { regions, devices } = getSnapshot()
    if (devices.some((device) => device.regionId === id)) return { ok: false, reason: '请先将该区域中的项目移到其他区域' }
    update({ regions: regions.filter((item) => item.id !== id) })
    return { ok: true }
  },
  async saveSettings(settings: DemoSettings) {
    update({ settings })
  },
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    await wait(1200)
    return { ok: true, message: '演示连接成功（未访问真实 Zabbix）' }
  },
  async setPalette(palette: PaletteId) {
    update({ palette })
  },
}
