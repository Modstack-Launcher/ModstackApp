import { parsePresence, type PresenceStatus } from "../utils/modstack";
import { useLauncherTranslation } from "../utils/languageContext";

interface StatusBadgeProps {
  status: PresenceStatus;
  activity: string | null;
  className?: string;
}

export default function StatusBadge({ status, activity, className = "" }: StatusBadgeProps) {
  const t = useLauncherTranslation();
  const presence = parsePresence(status, activity);

  const label =
    presence.kind === "playing"
      ? `${t("friends.playing")}: ${presence.text ?? "Minecraft"}`
      : presence.kind === "listening"
        ? `${t("friends.listening")}: ${presence.text ?? ""}`.trim()
        : presence.kind === "online"
          ? t("friends.online")
          : t("friends.offline");

  const active = presence.kind === "playing" || presence.kind === "listening";
  const dotClass =
    presence.kind === "offline"
      ? "bg-white/25"
      : active
        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.35)]"
        : "bg-accent shadow-[0_0_8px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]";
  const badgeClass =
    presence.kind === "offline"
      ? "border-white/10 bg-white/[0.035] text-white/45"
      : active
        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
        : "border-accent/20 bg-accent/10 text-foreground";

  return (
    <span
      key={`${presence.kind}-${presence.text ?? ""}`}
      className={[
        "presence-badge inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-all duration-200 ease-out",
        badgeClass,
        className,
      ].join(" ")}
      title={label}
    >
      <span className={["size-1.5 shrink-0 rounded-full", dotClass, active ? "animate-pulse" : ""].join(" ")} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
