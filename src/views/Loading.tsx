import { useEffect, useState } from 'react'

export default function Loading({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const duration = 1200
    const interval = 30
    const steps = duration / interval
    let current = 0
    let fadeOutTimer: ReturnType<typeof setTimeout> | null = null

    const timer = setInterval(() => {
      current++
      setProgress(Math.min(Math.round((current / steps) * 100), 100))
      if (current >= steps) {
        clearInterval(timer)
        setFadeOut(true)
        fadeOutTimer = setTimeout(onDone, 500)
      }
    }, interval)

    return () => {
      clearInterval(timer)
      if (fadeOutTimer !== null) clearTimeout(fadeOutTimer)
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-500"
      style={{
        opacity: fadeOut ? 0 : 1,
        pointerEvents: fadeOut ? 'none' : 'all',
        background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 35%, var(--color-background)), var(--color-background))",
      }}
    >
      <div
        className="flex flex-col items-center gap-6 transition-all duration-700"
        style={{
          transform: fadeOut ? 'scale(.05)' : 'scale(1)',
          opacity: fadeOut ? 0 : 1,
        }}
      >
        <div className="flex items-center gap-3">
          <img src="./icon.png" className="w-14 h-auto object-contain theme-tint-media" alt="" />
          <img src="./modstack-title.png" className="h-9 object-contain theme-tint-media" alt="Modstack" />
        </div>

        <div className="flex flex-col items-center gap-3 w-64">
          <div className="w-full h-[5px] bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
