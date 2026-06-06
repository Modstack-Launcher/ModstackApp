import { useState, useEffect } from "react";
import { cn, Label, ProgressBar } from "@heroui/react";
import { listen } from "@tauri-apps/api/event";

interface ProgressInfo {
  title: string;
  value: number;
  done?: boolean;
}

export default function ProgressRunning() {
  const [progressRunning, setProgressRunning] = useState(
    [] as [string, ProgressInfo][],
  );

  useEffect(() => {
    const unlistenProgress = listen("progress", (event: any) => {
      const { title, value } = event.payload;
      setProgressRunning((progressRunning) => {
        const newProgressRunning = progressRunning.filter(
          (p) => p[0] !== title,
        );
        newProgressRunning.push([title, { title, value }]);
        return newProgressRunning;
      });
    });

    const unlistenDone = listen("progress-done", (event: any) => {
      const title = event.payload as string;
      setProgressRunning((progressRunning) => {
        const newProgressRunning = progressRunning.filter(
          (p) => p[0] !== title,
        );
        if (!progressRunning.find((p) => p[0] === title && p[1].value === -1))
          newProgressRunning.push([title, { title, value: 100, done: true }]);
        return newProgressRunning;
      });
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, []);

  // Clear the panel once all visible items have finished.
  useEffect(() => {
    if (progressRunning.length === 0) return;
    if (!progressRunning.every(([, p]) => p.done)) return;

    const timer = setTimeout(() => setProgressRunning([]), 1000);
    return () => clearTimeout(timer);
  }, [progressRunning]);

  return (
    <div
      className={cn(
        "absolute top-10 right-0 max-w-60 w-60 p-1 inline-flex flex-col items-center justify-center subpixel-antialiased outline-none box-border text-small bg-content1 rounded-large shadow-medium",
        progressRunning.length === 0 && "hidden",
      )}
    >
      <div className="w-full flex flex-col gap-2 py-2 px-3">
        {progressRunning.map(([_, p]) => (
          <ProgressBar
            key={p.title}
            value={p.value}
            size={p.value === -1 ? "sm" : "md"}
            isIndeterminate={p.value === -1}
          >
            <Label>{p.title}</Label>
            <ProgressBar.Output />
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        ))}
      </div>
    </div>
  );
}
