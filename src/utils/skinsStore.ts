import {
  mkdir,
  readTextFile,
  writeTextFile,
  writeFile,
  readFile,
  remove,
  exists,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

export type ArmStyle = "wide" | "slim";

export type SkinMeta = {
  id: string;
  name: string;
  armStyle: ArmStyle;
  createdAt: number;
};

export type SavedSkin = SkinMeta & {
  dataUrl: string;
};

export const MODSTACK_SKIN_SERVER_URL =
  (import.meta.env.VITE_MODSTACK_SKIN_SERVER_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://skins.modstack.online:25654/Modstack/skins";

export const MODSTACK_SOCIAL_SERVER_URL =
  (import.meta.env.VITE_MODSTACK_SOCIAL_SERVER_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://skins.modstack.online:25654/Modstack/social";

async function getSkinsDir(): Promise<string> {
  const base = await appDataDir();
  return join(base, "skins");
}

async function ensureSkinsDir(): Promise<string> {
  const dir = await getSkinsDir();
  const dirExists = await exists(dir);
  if (!dirExists) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

async function getIndexPath(): Promise<string> {
  const dir = await getSkinsDir();
  return join(dir, "index.json");
}

export async function loadIndex(): Promise<SkinMeta[]> {
  try {
    const path = await getIndexPath();
    const pathExists = await exists(path);
    if (!pathExists) return [];
    const raw = await readTextFile(path);
    return JSON.parse(raw) as SkinMeta[];
  } catch {
    return [];
  }
}

async function saveIndex(metas: SkinMeta[]): Promise<void> {
  await ensureSkinsDir();
  const path = await getIndexPath();
  await writeTextFile(path, JSON.stringify(metas, null, 2));
}

const LS_ACTIVE = "modstack_active_skin_id";

export function getActiveId(): string | null {
  return localStorage.getItem(LS_ACTIVE);
}

export function setActiveId(id: string | null): void {
  if (id) localStorage.setItem(LS_ACTIVE, id);
  else localStorage.removeItem(LS_ACTIVE);
}

export async function loadSkinDataUrl(id: string): Promise<string | null> {
  try {
    const dir = await getSkinsDir();
    const pngPath = await join(dir, `${id}.png`);
    const pngExists = await exists(pngPath);
    if (!pngExists) return null;
    const bytes = await readFile(pngPath);
    const base64 = btoa(
      Array.from(bytes)
        .map((b) => String.fromCharCode(b))
        .join("")
    );
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
}

export async function loadAllSkins(): Promise<SavedSkin[]> {
  const metas = await loadIndex();
  const skins = await Promise.all(
    metas.map(async (meta) => {
      const dataUrl = await loadSkinDataUrl(meta.id);
      if (!dataUrl) return null;
      return { ...meta, dataUrl };
    })
  );
  return skins.filter(Boolean) as SavedSkin[];
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function addSkin(
  data: Omit<SavedSkin, "id" | "createdAt">
): Promise<SavedSkin> {
  const id = `skin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const meta: SkinMeta = {
    id,
    name: data.name,
    armStyle: data.armStyle,
    createdAt: Date.now(),
  };

  const dir = await ensureSkinsDir();
  const pngPath = await join(dir, `${id}.png`);

  await writeFile(pngPath, dataUrlToBytes(data.dataUrl));

  const metas = await loadIndex();
  await saveIndex([...metas, meta]);

  return { ...meta, dataUrl: data.dataUrl };
}

export async function updateSkin(
  id: string,
  data: Partial<Omit<SavedSkin, "id" | "createdAt">>
): Promise<void> {
  const metas = await loadIndex();
  const updated = metas.map((m) =>
    m.id === id
      ? {
          ...m,
          ...(data.name !== undefined && { name: data.name }),
          ...(data.armStyle !== undefined && { armStyle: data.armStyle }),
        }
      : m
  );
  await saveIndex(updated);

  if (data.dataUrl) {
    const dir = await getSkinsDir();
    const pngPath = await join(dir, `${id}.png`);
    await writeFile(pngPath, dataUrlToBytes(data.dataUrl));
  }
}

export async function deleteSkin(id: string): Promise<void> {
  const dir = await getSkinsDir();
  const pngPath = await join(dir, `${id}.png`);
  const pngExists = await exists(pngPath);
  if (pngExists) await remove(pngPath);

  const metas = await loadIndex();
  await saveIndex(metas.filter((m) => m.id !== id));
}

export async function uploadSkinToMojang(
  dataUrl: string,
  armStyle: ArmStyle,
  accessToken: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await invoke("upload_skin_to_mojang", {
      dataUrl,
      armStyle,
      accessToken,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function uploadSkinToModstack(
  dataUrl: string,
  armStyle: ArmStyle,
  username: string,
  uuid?: string | null
): Promise<{ ok: boolean; error?: string; response?: unknown }> {
  try {
    const response = await invoke("upload_skin_to_modstack", {
      serverUrl: MODSTACK_SKIN_SERVER_URL,
      dataUrl,
      username,
      uuid: uuid || null,
      armStyle,
    });
    return { ok: true, response };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function uploadSocialMediaToModstack(
  dataUrl: string,
  userId: string,
  kind: "banner"
): Promise<{ ok: boolean; url?: string; error?: string; response?: unknown }> {
  try {
    const response = await invoke<{ url?: string }>("upload_social_media_to_modstack", {
      serverUrl: MODSTACK_SOCIAL_SERVER_URL,
      dataUrl,
      userId,
      kind,
    });
    return { ok: true, url: response?.url, response };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function applySkinLocally(
  dataUrl: string,
  playerUuid: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await invoke("apply_skin_locally", {
      dataUrl,
      playerUuid,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
