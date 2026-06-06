import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Update } from '@tauri-apps/plugin-updater'

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'downloaded'

interface UpdateContextType {
  status: UpdateStatus
  version: string | null
  body: string | null
  downloadProgress: number
  startCheck: () => void
  applyUpdate: () => Promise<void>
  closeWithInstall: () => Promise<void>
}

const UpdateContext = createContext<UpdateContextType>({
  status: 'idle',
  version: null,
  body: null,
  downloadProgress: 0,
  startCheck: () => {},
  applyUpdate: async () => {},
  closeWithInstall: async () => {},
})

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const pendingUpdate = useRef<Update | null>(null)
  const hasStarted = useRef(false)

  const startCheck = useCallback(async () => {
    if (hasStarted.current) return
    hasStarted.current = true
    setStatus('checking')
    try {
      const update = await check()
      if (!update?.available) {
        setStatus('idle')
        return
      }
      setVersion(update.version)
      setBody(update.body ?? null)
      setStatus('downloading')
      let downloaded = 0
      let total = 0
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (total > 0) setDownloadProgress(Math.round((downloaded / total) * 100))
        }
      })
      pendingUpdate.current = update
      setStatus('downloaded')
    } catch (err) {
      console.error('[updater]', err)
      setStatus('idle')
    }
  }, [])

  const applyUpdate = useCallback(async () => {
    if (!pendingUpdate.current) return
    try {
      await pendingUpdate.current.install()
      await relaunch()
    } catch (err) {
      console.error('[updater] install failed:', err)
    }
  }, [])

  useEffect(() => { startCheck() }, [])

  // Called by Frame's close button when an update is ready.
  // Attempts a best-effort install before closing so the next manual
  // launch already runs the new version — no onCloseRequested needed.
  const closeWithInstall = useCallback(async () => {
    if (pendingUpdate.current) {
      try {
        await Promise.race([
          pendingUpdate.current.install(),
          new Promise<void>((_, reject) => setTimeout(() => reject(), 2000)),
        ])
      } catch {}
    }
    await getCurrentWindow().close()
  }, [])

  return (
    <UpdateContext.Provider value={{ status, version, body, downloadProgress, startCheck, applyUpdate, closeWithInstall }}>
      {children}
    </UpdateContext.Provider>
  )
}

export function useUpdate() {
  return useContext(UpdateContext)
}
