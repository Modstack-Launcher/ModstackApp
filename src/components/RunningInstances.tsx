import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@heroui/react";
import { IconPlayerPlay, IconPlayerStop, IconX } from "@tabler/icons-react";
import { useLaunch } from "../stores/launchContext";
import { useInstance } from "../stores/instanceContext";
import { useNavigation } from "../hooks/useNavigation";
import { useLauncherTranslation } from "../utils/languageContext";

export function RunningInstances() {
  const t = useLauncherTranslation();
  const { runningInstances } = useLaunch();
  const { instances } = useInstance();
  const push = useNavigation((state) => state.push);
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const count = runningInstances.size;
  const hasRunning = count > 0;

  const runningDetails = [...runningInstances].map((id) => {
    const inst = instances.find((i) => i.id === id);
    return inst ?? ({ id, title: id } as unknown as Instance);
  });

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  const handleStop = async (instanceId: string) => {
    try {
      await invoke("stop_instance", { instanceId });
    } catch (e) {
      console.error("Error stopping instance:", e);
    }
  };

  const handleNavigate = (instanceId: string) => {
    window.dispatchEvent(new CustomEvent("open-local-instance", { detail: instanceId }));
    push("instances");
    setOpen(false);
  };

  return (
    <div className="relative flex items-center" ref={popupRef}>
      <Button
        variant="ghost"
        size="lg"
        onPress={hasRunning ? () => setOpen((v) => !v) : undefined}
        className="rounded-none ring-inset gap-1.5 px-3"
        aria-label={
          hasRunning
            ? `${count} instance${count !== 1 ? "s" : ""} running`
            : t("running.noInstances")
        }
      >
        {hasRunning ? (
          <>
            <span className="size-1.5 rounded-full bg-success animate-pulse shrink-0" />
            <span className="text-xs max-w-[140px] truncate">
              {count === 1 ? runningDetails[0].title : `${count} running`}
            </span>
          </>
        ) : (
          <>
            <IconPlayerPlay size={13} className="opacity-35 shrink-0" />
            <span className="text-xs opacity-35">{t("running.noInstances")}</span>
          </>
        )}
      </Button>

      {open && hasRunning && (
        <div className="absolute right-0 top-full mt-1 min-w-[260px] z-50 rounded-lg border border-white/10 bg-surface shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-success animate-pulse" />
              {t("running.running")}
            </div>
            <Button
              variant="ghost"
              isIconOnly
              onPress={() => setOpen(false)}
              className="size-5 rounded"
            >
              <IconX size={12} />
            </Button>
          </div>

          <div className="flex flex-col py-1">
            {runningDetails.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
              >
                {inst.icon && (
                  <img
                    src={inst.icon}
                    alt=""
                    className="size-6 rounded object-cover shrink-0"
                  />
                )}
                <button
                  onClick={() => handleNavigate(inst.id)}
                  className="flex-1 text-sm text-left truncate hover:text-accent transition-colors cursor-pointer"
                >
                  {inst.title || inst.id}
                </button>
                <Button
                  variant="ghost"
                  isIconOnly
                  onPress={() => handleStop(inst.id)}
                  className="size-6 rounded shrink-0 text-danger-soft-foreground hover:bg-danger-soft-hover"
                  aria-label={`Stop ${inst.title || inst.id}`}
                >
                  <IconPlayerStop size={12} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}