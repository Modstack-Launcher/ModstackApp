import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openShell } from "@tauri-apps/plugin-shell";
import {
  Modal,
  Button,
  TextField,
  Label,
  Input,
  useOverlayState,
} from "@heroui/react";
import { useAuth, userKey } from "../stores/authContext";
import { useModstack } from "../stores/modstackContext";
import { useLauncherTranslation } from "../utils/languageContext";
import Ms from "./icons/Ms";
import {
  IconChevronDown,
  IconChevronRight,
  IconTrash,
  IconPlus,
  IconX,
  IconUserPlus,
  IconShoppingCart,
  IconSpeakerphone,
} from "@tabler/icons-react";

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

interface LauncherNewsItem {
  id: string;
  title: string;
  content: string;
  image: string;
  createdAt: string;
  published: boolean;
}

interface MinecraftNewsItem {
  id: string;
  title: string;
  date: string;
  description?: string | null;
  image?: string | null;
  readMoreLink?: string | null;
}

interface MojangNewsEntry {
  id: string;
  title: string;
  tag?: string;
  category?: string;
  date: string;
  text: string;
  playPageImage?: { title: string; url: string };
  newsPageImage?: { title: string; url: string; dimensions?: { width: number; height: number } };
  readMoreLink?: string;
  newsType?: string[];
}

interface MojangNewsResponse {
  version: number;
  entries: MojangNewsEntry[];
}

const MOJANG_NEWS_URL = "https://launchercontent.mojang.com/news.json";
const MOJANG_NEWS_BASE = "https://launchercontent.mojang.com";

function mojangImageUrl(path?: string) {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${MOJANG_NEWS_BASE}${path}`;
}

function mojangEntryToNewsItem(e: MojangNewsEntry): MinecraftNewsItem {
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    description: e.text,
    image: mojangImageUrl(e.newsPageImage?.url ?? e.playPageImage?.url) ?? null,
    readMoreLink: e.readMoreLink ?? null,
  };
}

function formatNewsDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

function excerpt(content: string, maxLen = 90) {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen).trim()}…` : clean;
}

function mojangImage(n: MinecraftNewsItem): string | undefined {
  return n.image ?? undefined;
}

const skinHelmURL = (name: string) => `https://mineskin.eu/helm/${name}/40.png`;

function AccountsBlock() {
  const t = useLauncherTranslation();
  const {
    authReady,
    user,
    userList,
    selectUser,
    removeUser,
    loginWithMicrosoft,
    loginWithMojang,
  } = useAuth();

  const modalState = useOverlayState();
  const [expanded, setExpanded] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [loginMode, setLoginMode] = useState<"microsoft" | "offline" | null>(null);
  const [offlineUsername, setOfflineUsername] = useState("");

  const getUserType = (u: any) => (u.type === "microsoft" ? t("user.microsoft") : t("user.offline"));

  const handleAddMicrosoft = async () => {
    setShowAddMenu(false);
    setLoginMode("microsoft");
    modalState.open();
    try {
      await loginWithMicrosoft();
    } catch (e) {
      console.error("Login Microsoft failed", e);
    } finally {
      modalState.close();
      setLoginMode(null);
    }
  };

  const handleAddOffline = () => {
    setShowAddMenu(false);
    setLoginMode("offline");
    modalState.open();
  };

  const handleOfflineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginWithMojang(offlineUsername)
      .then(() => {
        modalState.close();
        setOfflineUsername("");
        setLoginMode(null);
      })
      .catch(console.error);
  };

  const handleOfflineCancel = () => {
    modalState.close();
    setOfflineUsername("");
    setLoginMode(null);
  };

  if (!authReady) return null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-muted text-[11px] font-semibold tracking-widest uppercase px-0.5">
          {t("home.playingAs") ?? "Jugando como"}
        </span>

        <div
          className="rounded-[12px] border overflow-hidden"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full group flex items-center gap-3 px-3 py-2.5 transition-colors duration-200 hover:bg-white/5"
          >
            <img
              src={user?.minecraft?.name ? skinHelmURL(user.minecraft.name) : "./steve-helm.png"}
              alt={user?.minecraft?.name ?? ""}
              className="size-9 rounded-[8px] shrink-0"
            />
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-bold text-foreground truncate">
                {user?.minecraft?.name ?? t("user.notLoggedIn")}
              </p>
              <p className="text-muted text-xs">{t("home.minecraftAccount") ?? "Cuenta de Minecraft"}</p>
            </div>
            <IconChevronDown
              size={16}
              className={`text-muted shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            />
          </button>

          {expanded && (
            <div className="border-t animate-in flex flex-col" style={{ borderColor: "var(--color-border)" }}>
              {userList.map((u) => (
                <div
                  key={u.minecraft.uuid}
                  className="group flex items-center gap-2.5 px-3 py-2 transition-colors duration-200 hover:bg-white/5"
                >
                  <button
                    onClick={() => selectUser(u)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <span
                      className={`size-2 rounded-full shrink-0 ${
                        user && userKey(user) === userKey(u) ? "bg-emerald-400" : "bg-white/20"
                      }`}
                    />
                    <img
                      src={skinHelmURL(u.minecraft.name)}
                      alt={u.minecraft.name}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "./steve-helm.png";
                      }}
                      className="size-6 rounded-[6px] shrink-0"
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-foreground truncate">{u.minecraft.name}</span>
                      <span className="text-[10px] text-muted truncate">{getUserType(u)}</span>
                    </div>
                  </button>
                  {!(user && userKey(user) === userKey(u)) && (
                    <button
                      onClick={() => removeUser(u)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1.5 rounded-[6px] hover:bg-white/10 shrink-0"
                      title={t("home.removeAccount") ?? "Eliminar cuenta"}
                    >
                      <IconTrash size={14} className="text-muted hover:text-red-400" />
                    </button>
                  )}
                </div>
              ))}

              {!showAddMenu ? (
                <button
                  onClick={() => setShowAddMenu(true)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium text-muted hover:text-foreground transition-colors duration-200 hover:bg-white/5"
                >
                  <IconPlus size={14} />
                  {t("home.addAccount") ?? "Agregar cuenta"}
                </button>
              ) : (
                <div className="flex flex-col animate-in" style={{ borderColor: "var(--color-border)" }}>
                  <button
                    onClick={handleAddMicrosoft}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-white/5 transition-colors duration-200"
                  >
                    <Ms className="w-4 h-4" />
                    {t("user.addMicrosoft") ?? "Microsoft"}
                  </button>
                  <button
                    onClick={handleAddOffline}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-white/5 transition-colors duration-200"
                  >
                    <IconUserPlus size={16} />
                    {t("user.addOffline") ?? "Offline"}
                  </button>
                  <button
                    onClick={() => setShowAddMenu(false)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-muted hover:text-foreground transition-colors duration-200 hover:bg-white/5"
                  >
                    {t("user.cancel") ?? "Cancelar"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal.Backdrop
        isDismissable={false}
        isKeyboardDismissDisabled={loginMode === "microsoft"}
        isOpen={modalState.isOpen}
        onOpenChange={modalState.setOpen}
      >
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>
                {loginMode === "microsoft" ? t("user.signingIn") : t("user.addOffline")}
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body className="p-2 gap-4">
              {loginMode === "microsoft" ? (
                <p className="text-center text-sm text-muted">{t("user.pleaseWait")}</p>
              ) : (
                <form
                  autoComplete="off"
                  onSubmit={handleOfflineSubmit}
                  onReset={handleOfflineCancel}
                  className="flex flex-col gap-4"
                >
                  <TextField
                    variant="secondary"
                    name="username"
                    isRequired
                    value={offlineUsername}
                    onChange={(val) => setOfflineUsername(val.replace(/[^a-zA-Z0-9_]/g, ""))}
                    autoFocus
                  >
                    <Label>{t("user.username")}</Label>
                    <Input placeholder={t("user.usernamePlaceholder")} minLength={3} maxLength={16} />
                  </TextField>

                  <div className="flex gap-2 justify-end">
                    <Button type="reset" variant="secondary" size="sm" fullWidth>
                      {t("user.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      fullWidth
                      isDisabled={offlineUsername.length < 3 || offlineUsername.length > 16}
                    >
                      {t("user.confirm")}
                    </Button>
                  </div>

                  <hr className="border-border/40" />

                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    onPress={() => openShell("https://www.minecraft.net/en-us/choose-your-game")}
                    className="text-blue-400 border-blue-900 bg-blue-950/40 hover:bg-blue-900/40"
                  >
                    <IconShoppingCart className="w-4 h-4" />
                    {t("user.buyMinecraft")}
                  </Button>
                </form>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

function ModstackSignInPrompt() {
  const t = useLauncherTranslation();
  const { account: modstackAccount, login: modstackLogin, isWaitingLogin } = useModstack();

  if (modstackAccount) return null;

  const handleLogin = () => {
    modstackLogin("discord").catch(() => {});
  };

  return (
    <p className="text-xs text-muted leading-relaxed">
      <button
        onClick={handleLogin}
        disabled={isWaitingLogin}
        className="font-semibold hover:underline disabled:opacity-50"
        style={{ color: "var(--color-accent)" }}
      >
        {isWaitingLogin
          ? (t("friends.loginWaiting") ?? "Esperando confirmación…")
          : (t("home.signInModstack") ?? "Iniciá sesión con tu cuenta de Modstack")}
      </button>{" "}
      {t("home.signInModstackDesc") ?? "para agregar amigos y ver qué están jugando."}
    </p>
  );
}

const NEWS_BLOCK_LIMIT = 4;

const FALLBACK_GRADIENTS = [
  "radial-gradient(circle at 30% 20%, rgba(139,58,180,0.55), rgba(122,47,106,0.35) 60%, var(--color-surface-secondary) 100%)",
  "radial-gradient(circle at 30% 20%, rgba(51,230,160,0.35), var(--color-surface-secondary) 65%)",
  "radial-gradient(circle at 30% 20%, rgba(58,143,217,0.4), var(--color-surface-secondary) 65%)",
];

function fallbackGradientFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_GRADIENTS[hash % FALLBACK_GRADIENTS.length];
}

function NewsRow({
  id,
  title,
  description,
  image,
  date,
  onOpen,
}: {
  id: string;
  title: string;
  description?: string | null;
  image?: string | null;
  date: string;
  onOpen: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  return (
    <button onClick={onOpen} className="w-full text-left flex flex-col gap-2">
      <div
        className="w-full aspect-video overflow-hidden rounded-[12px]"
        style={{ background: "var(--color-surface-secondary)" }}
      >
        {image && !imgError ? (
          <img
            src={image}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: fallbackGradientFor(id) }}
          >
            <IconSpeakerphone size={22} className="text-muted" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
          {title}
        </h3>
        {description && <p className="text-xs text-muted line-clamp-1 leading-snug">{description}</p>}
        <span className="text-[10px] text-muted mt-0.5">{date}</span>
      </div>
    </button>
  );
}

function NewsRowSkeleton() {
  return (
    <div className="w-full flex flex-col gap-2 animate-pulse">
      <div className="w-full aspect-video rounded-[12px]" style={{ background: "var(--color-surface-secondary)" }} />
      <div className="flex flex-col gap-1.5">
        <div className="h-3 w-4/5 rounded" style={{ background: "var(--color-surface-secondary)" }} />
        <div className="h-2.5 w-full rounded" style={{ background: "var(--color-surface-secondary)" }} />
        <div className="h-2 w-1/4 rounded mt-0.5" style={{ background: "var(--color-surface-secondary)" }} />
      </div>
    </div>
  );
}

function LauncherNewsModal({ item, onClose }: { item: LauncherNewsItem; onClose: () => void }) {
  const date = new Date(item.createdAt).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fixed z-9999 top-0 left-0 w-screen h-screen bg-black/50 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute" onClick={(e) => e.stopPropagation()}>
        <Button variant="tertiary" size="sm" isIconOnly className="absolute z-20 top-3 right-3" onPress={onClose}>
          <IconX size={16} />
        </Button>
        <div
          className="bg-background border border-border/30 rounded-3xl"
          style={{ width: "min(680px, 90vw)", height: "80vh", overflowY: "auto" }}
        >
          <div className="relative z-10 overflow-hidden" style={{ width: "100%", height: "60%" }}>
            <img
              src={item.image}
              alt={item.title}
              className="absolute -z-10 blur-3xl opacity-30"
              style={{ width: "300%", height: "300%", objectFit: "cover" }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <img
              src={item.image}
              alt={item.title}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          <div className="bg-surface" style={{ padding: "20px 24px" }}>
            <h2 style={{ margin: "0 0 3px", fontSize: 20, fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>
              {item.title}
            </h2>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 11,
                color: "var(--accent)",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {date}
            </p>
            <p
              className="text-muted"
              style={{ margin: 0, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", userSelect: "text" }}
            >
              {item.content}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const NEWS_VIEW_ALL_URL: Record<"launcher" | "minecraft", string> = {
  launcher: "https://www.modstack.online/changelog",
  minecraft: "https://www.minecraft.net/en-us/article",
};

function NewsBlock() {
  const t = useLauncherTranslation();
  const [newsTab, setNewsTab] = useState<"launcher" | "minecraft">("launcher");

  const [news, setNews] = useState<LauncherNewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [selectedNews, setSelectedNews] = useState<LauncherNewsItem | null>(null);

  const [mcNews, setMcNews] = useState<MinecraftNewsItem[]>([]);
  const [loadingMcNews, setLoadingMcNews] = useState(true);

  useEffect(() => {
    invoke<LauncherNewsItem[]>("get_news")
      .then((data) => setNews(data.filter((n) => n.published)))
      .catch((e) => console.error("Error loading launcher news:", e))
      .finally(() => setLoadingNews(false));
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch(MOJANG_NEWS_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<MojangNewsResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setMcNews((data.entries ?? []).map(mojangEntryToNewsItem));
      })
      .catch((e) => console.error("Error loading Minecraft news:", e))
      .finally(() => {
        if (!cancelled) setLoadingMcNews(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isLauncherTab = newsTab === "launcher";
  const loading = isLauncherTab ? loadingNews : loadingMcNews;
  const items = isLauncherTab
    ? news
        .filter((n) => n.image && n.image.trim() !== "")
        .map((n) => ({
          id: n.id,
          title: n.title,
          description: excerpt(n.content),
          image: n.image as string | null | undefined,
          date: formatNewsDate(n.createdAt),
          onOpen: () => setSelectedNews(n),
        }))
    : mcNews
        .filter((n) => n.image && n.image.trim() !== "")
        .map((n) => ({
          id: n.id,
          title: n.title,
          description: n.description,
          image: mojangImage(n),
          date: formatNewsDate(n.date),
          onOpen: () => openShell(n.readMoreLink ?? "https://www.minecraft.net").catch(console.error),
        }));
  const visibleItems = items.slice(0, NEWS_BLOCK_LIMIT);

  const handleViewAll = () => {
    openShell(NEWS_VIEW_ALL_URL[newsTab]).catch(console.error);
  };

  return (
    <>
      {selectedNews && <LauncherNewsModal item={selectedNews} onClose={() => setSelectedNews(null)} />}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0 px-0.5">
          <span className="text-muted text-[11px] font-semibold tracking-widest uppercase">
            {t("home.news") ?? "Noticias"}
          </span>
          <div className="flex items-center gap-1 p-0.5 rounded-[8px]" style={{ background: "var(--color-surface-secondary)" }}>
            <button
              onClick={() => setNewsTab("launcher")}
              className="px-2.5 py-1 rounded-[6px] text-[11px] font-medium transition-all duration-150 hover:brightness-110 active:scale-95"
              style={{
                background: newsTab === "launcher" ? "var(--color-accent)" : "transparent",
                color: newsTab === "launcher" ? "#000" : "var(--color-muted)",
              }}
            >
              Launcher
            </button>
            <button
              onClick={() => setNewsTab("minecraft")}
              className="px-2.5 py-1 rounded-[6px] text-[11px] font-medium transition-all duration-150 hover:brightness-110 active:scale-95"
              style={{
                background: newsTab === "minecraft" ? "var(--color-accent)" : "transparent",
                color: newsTab === "minecraft" ? "#000" : "var(--color-muted)",
              }}
            >
              Minecraft
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <NewsRowSkeleton key={i} />)
          ) : visibleItems.length === 0 ? (
            <p className="text-muted text-xs">{t("home.noNews") ?? "Sin novedades por ahora."}</p>
          ) : (
            <>
              {visibleItems.map((n) => (
                <NewsRow
                  key={n.id}
                  id={n.id}
                  title={n.title}
                  description={n.description}
                  image={n.image}
                  date={n.date}
                  onOpen={n.onOpen}
                />
              ))}

              <button
                onClick={handleViewAll}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-bold transition-opacity hover:opacity-80"
                style={{ color: "var(--color-accent)" }}
              >
                <IconChevronRight size={16} />
                {t("home.viewAllNews") ?? "Ver todo"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Annnounce() {
  const containerRef = useRef<HTMLDivElement>(null);
  const adPushed = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ad = el.querySelector(".adsbygoogle") as HTMLElement;

    const tryPush = () => {
      if (adPushed.current) return;

      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;

      if (ad?.dataset.adsbygoogleStatus) {
        adPushed.current = true;
        return;
      }

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        adPushed.current = true;
        console.log("AdSense pushed");
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.includes("already have ads in them")
        ) {
          adPushed.current = true;
          return;
        }

        console.error("AdSense push error:", e);
      }
    };

    requestAnimationFrame(tryPush);

    const observer = new ResizeObserver(() => {
      if (!adPushed.current) {
        requestAnimationFrame(tryPush);
      }
    });

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative shrink-0 h-[180px] w-full">
      <div
        ref={containerRef}
        className="overflow-hidden flex items-center justify-center"
        style={{
          position: "absolute",
          top: "0px",
          left: "-20px",
          width: "118%",
          height: "204px",
          background:
            "color-mix(in srgb, var(--color-accent) 10%, var(--color-surface))",
        }}
      >
        <ins
          className="adsbygoogle"
          style={{
            display: "inline-block",
            width: "300px",
            height: "250px",
          }}
          data-ad-client="ca-pub-6047591702608332"
          data-ad-slot="5301304422"
          data-ad-format="auto"
        />
      </div>
    </div>
  );
}

export default function HomeSidebar() {
  return (
    <>
      <style>{`
        .custom-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 10px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.28); }
        @keyframes home-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: home-fade-in 150ms ease-out; }
      `}</style>
      <aside
        className="w-[280px] shrink-0 h-full flex flex-col px-5 py-6"
        style={{
          background: "#0a0f1b",
          borderLeft: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto custom-scroll pr-2.5 -mr-5">
          <AccountsBlock />
          <ModstackSignInPrompt />
          <NewsBlock />
        </div>
        <div className="shrink-0 flex flex-col gap-4">
          <Annnounce />
        </div>
      </aside>
    </>
  );
}
