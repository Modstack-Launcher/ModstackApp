import { useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

// Images that could not be loaded directly are fetched once through the Rust
// backend (no hot-link/referrer/CORS restrictions) and cached for the session.
const proxied = new Map<string, Promise<string>>();

function loadThroughBackend(url: string): Promise<string> {
  let pending = proxied.get(url);
  if (!pending) {
    pending = invoke<string>("fetch_remote_image", { url });
    pending.catch(() => proxied.delete(url));
    proxied.set(url, pending);
  }
  return pending;
}

type LoadState = { src: string; stage: "proxy" | "failed"; url?: string };

/**
 * News thumbnail with graceful degradation:
 * direct URL → backend proxy (data URL) → `fallback` content.
 */
export default function NewsImage({ src, alt = "", className, style, fallback }: {
  src?: string | null;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
}) {
  // State only applies to the `src` it was recorded for, so a new `src` starts
  // again from the direct URL without resetting state inside an effect.
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const state = src && loadState?.src === src ? loadState : null;

  const handleError = () => {
    if (!src) return;
    if (!state && /^https?:/i.test(src)) {
      setLoadState({ src, stage: "proxy" });
      loadThroughBackend(src)
        .then(url => setLoadState(previous => (previous?.src === src ? { src, stage: "proxy", url } : previous)))
        .catch(() => setLoadState(previous => (previous?.src === src ? { src, stage: "failed" } : previous)));
      return;
    }
    setLoadState({ src, stage: "failed" });
  };

  if (!src || state?.stage === "failed") return <>{fallback ?? null}</>;
  const current = state?.stage === "proxy" ? state.url : src;
  if (!current) return <>{fallback ?? null}</>;
  return (
    <img
      src={current}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={handleError}
    />
  );
}
