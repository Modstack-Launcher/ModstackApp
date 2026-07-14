import { useState, useEffect, useMemo, useRef } from "react";
import { useInstance } from "../stores/instanceContext";
import { listen } from "@tauri-apps/api/event";
import { cn, Button, Drawer } from "@heroui/react";
import { IconTerminal2 } from "@tabler/icons-react";

interface Log {
  instance: string;
  type: string;
  message: string;
}

interface Props {
  overrideInstance?: string;
}

export default function InstanceLogger({ overrideInstance }: Props) {
  const [instanceLogger, setInstanceLogger] = useState([] as Log[]);
  const { isRunning, selectedInstance } = useInstance();
  const instanceLoggerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const unlistenLog = listen("instance-logger", (event) => {
      setInstanceLogger((prev) => {
        const next = [...prev, event.payload as Log];
        return next.length > 1000 ? next.slice(-1000) : next;
      });
    });

    return () => {
      unlistenLog.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (autoScroll)
      instanceLoggerRef.current?.scrollTo(0, instanceLoggerRef.current?.scrollHeight);
  }, [instanceLogger, autoScroll]);

  const instanceIdentifier = useMemo(() => {
    if (overrideInstance) return overrideInstance;
    if (selectedInstance) return `${selectedInstance.id}-${selectedInstance.slug}`;
    return "null";
  }, [selectedInstance, overrideInstance]);

  const instanceLoggerLast = useMemo(() => {
    if (instanceLogger.filter((l) => l.instance === instanceIdentifier).length > 0) {
      const lastLog = [...instanceLogger]
        .reverse()
        .find((l) => l.instance === instanceIdentifier)?.message;
      if (lastLog?.startsWith("[")) return lastLog.slice(11);
      else return lastLog;
    } else if (isRunning && selectedInstance) return selectedInstance.title;
    return "Waiting for instance to launch";
  }, [instanceLogger, isRunning, selectedInstance, instanceIdentifier]);

  return (
    <Drawer>
      <Button
        variant="tertiary"
        size="sm"
        fullWidth
        className={cn(
          "justify-start rounded-none text-muted overflow-hidden relative",
          [...instanceLogger]
            .reverse()
            .find((l) => l.instance === instanceIdentifier)?.type === "error" &&
            "text-red-500",
        )}
      >
        <IconTerminal2 className={cn("shrink-0", isRunning && "text-[var(--color-accent)]")} />
        <span className={cn("truncate", instanceLogger.length === 0 && "opacity-50")}>
          {instanceLoggerLast}
        </span>
      </Button>

      <Drawer.Backdrop variant="transparent">
        <Drawer.Content className="pl-18">
          <Drawer.Dialog className="pb-0 px-2 pt-3 bg-surface-secondary">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>{selectedInstance?.title}</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <div
                ref={instanceLoggerRef}
                className="w-full min-h-60 max-h-[60vh] flex flex-col bg-black rounded overflow-x-hidden [&>*:nth-child(2n)]:bg-white/5"
                onScroll={(e) => {
                  if (e.currentTarget.scrollTop === 0) setAutoScroll(false);
                  else if (
                    e.currentTarget.scrollHeight - e.currentTarget.scrollTop ===
                    e.currentTarget.clientHeight
                  )
                    setAutoScroll(true);
                  else setAutoScroll(false);
                }}
              >
                {instanceLogger.filter((l) => l.instance === instanceIdentifier).length === 0 && (
                  <div className="p-3 text-white/75">
                    Waiting for instance to launch
                  </div>
                )}
                {instanceLogger
                  .filter((l) => l.instance === instanceIdentifier)
                  .map((log, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-full px-3 first:pt-2 last:pb-2",
                        log.type === "log" && "text-white",
                        log.type === "error" && "text-red-500",
                      )}
                    >
                      {log.message}
                    </div>
                  ))}
              </div>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}