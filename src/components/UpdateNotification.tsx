import { useState } from 'react'
import { IconRefresh, IconX, IconList } from '@tabler/icons-react'
import { open } from '@tauri-apps/plugin-shell'
import { useUpdate } from '../stores/updateContext'
import { useLauncherTranslation } from '../utils/languageContext'

const CHANGELOG_URL = 'https://www.modstack.online/changelog'

export function UpdateNotification() {
  const t = useLauncherTranslation();
  const { status, version, applyUpdate } = useUpdate()

  const [dismissed, setDismissed] = useState(false)
  const [closing, setClosing] = useState(false)

  const handleClose = () => {
    setClosing(true)
    setTimeout(() => { setDismissed(true) }, 450)
  }

  if (status !== 'downloaded' || dismissed) return null

  return (
    <>
      <style>{`
        @keyframes notification-enter {
          0% { opacity: 0; transform: translateX(60px); }
          70% { opacity: 1; transform: translateX(-4px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes notification-exit {
          0% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(60px); }
        }
        @keyframes slow-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .update-notification { animation: notification-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
        .update-notification.closing { animation: notification-exit 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .update-icon { animation: slow-spin 3s linear infinite; }
      `}</style>

      <div
        className={`update-notification ${closing ? 'closing' : ''} fixed bottom-4 right-4 z-50 w-80 rounded-[14px] border border-white/10 shadow-2xl overflow-hidden backdrop-blur-xl`}
        style={{ backgroundColor: 'var(--color-overlay)' }}
      >
        <div className="flex items-start gap-3 p-4">
          <div className="w-8 h-8 rounded-full bg-[#4b77e7]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <IconRefresh size={15} className="text-[#4b77e7] update-icon" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("update.title")}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {t("update.desc").replace("{version}", version ?? "")}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={applyUpdate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] bg-[#4b77e7]/15 border border-[#4b77e7]/30 text-[#4b77e7] text-xs font-medium hover:bg-[#4b77e7]/25 hover:scale-105 active:scale-95 transition-all duration-200"
              >
                {t("update.reload")}
              </button>

              <button
                onClick={() => open(CHANGELOG_URL)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] border border-white/10 text-muted text-xs font-medium hover:text-foreground hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-200"
              >
                <IconList size={11} />
                {t("update.changelog")}
              </button>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-6 h-6 flex items-center justify-center rounded-[7px] text-muted hover:text-foreground hover:bg-white/5 hover:scale-110 active:scale-90 transition-all duration-200 flex-shrink-0"
          >
            <IconX size={13} />
          </button>
        </div>
      </div>
    </>
  )
}