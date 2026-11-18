'use client'

import { useEffect, useRef, useState } from 'react'
import { startSnapshotPolling, type SnapshotPath, type SnapshotState } from '@/lib/snapshot-polling'

export function useMonitorSnapshot(path: SnapshotPath, refreshVersion?: number) {
  const [state, setState] = useState<SnapshotState>({ clockOffset: 0, failed: false })
  const previousVersion = useRef(refreshVersion)
  const controller = useRef<ReturnType<typeof startSnapshotPolling> | null>(null)

  useEffect(() => {
    const poll = startSnapshotPolling(path, setState, document)
    controller.current = poll
    return () => {
      poll.stop()
      controller.current = null
    }
  }, [path])

  useEffect(() => {
    if (previousVersion.current === refreshVersion) return
    previousVersion.current = refreshVersion
    controller.current?.refresh()
  }, [refreshVersion])

  return state
}
