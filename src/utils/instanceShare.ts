import { invoke } from "@tauri-apps/api/core";
import { mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { slugify, type LocalInstance } from "./localInstances";

export interface InstanceSharePayload {
  type: "modstack-instance";
  version: 2;
  title: string;
  minecraft_version: string;
  loader: LocalInstance["loader"];
  created_at: number;
  icon?: SharedAsset | null;
  background?: SharedAsset | null;
  mods?: SharedMod[];
}

interface SharedMod {
  filename: string;
  download_url?: string;
  contents?: string;
}

interface SharedAsset {
  filename: string;
  bytes: number[];
}

const PORTABLE_PREFIX = "MSP-";
const PREFIX = "MS-";
const REGISTRY_KEY = "modstack.instanceShare.codes";
const MESSAGE_RE = /\[\[MODSTACK_INSTANCE:([A-Za-z0-9_-]+)\]\]/;

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function createInstanceSharePayload(instance: LocalInstance): InstanceSharePayload {
  return {
    type: "modstack-instance",
    version: 2,
    title: instance.title,
    minecraft_version: instance.minecraft_version,
    loader: instance.loader,
    created_at: Date.now(),
  };
}

export async function createInstanceSharePayloadWithAssets(instance: LocalInstance): Promise<InstanceSharePayload> {
  const payload = createInstanceSharePayload(instance);
  // Keep share codes compact: instance artwork is decorative and can make a
  // code several times larger without affecting the imported mods.
  const mods = await invoke<Array<{ filename: string; download_url?: string }>>("get_installed_mods", {
    instanceId: instance.id,
    projectType: "mod",
  }).catch(() => []);
  const installDir = await invoke<string>("get_install_dir");
  const sharedMods: Array<SharedMod | null> = await Promise.all(mods.map(async (mod): Promise<SharedMod | null> => {
    const filename = mod.filename.split(/[\\/]/).pop() || "";
    if (!/^[^/\\]+\.(?:jar|zip)(?:\.disabled)?$/i.test(filename)) return null;
    if (mod.download_url && isSupportedModDownload(mod.download_url)) {
      return { filename, download_url: mod.download_url };
    }
    try {
      const filePath = await join(installDir, "instances", instance.id, "mods", filename);
      const bytes = await readFile(filePath);
      return { filename, contents: bytesToBase64Url(bytes) };
    } catch {
      return null;
    }
  }));
  payload.mods = sharedMods.filter((item): item is SharedMod => item !== null);
  return payload;
}

export function encodeInstanceShare(payload: InstanceSharePayload) {
  // Codes must contain the payload so they work on another computer too;
  // the old random MS- codes only referred to this install's localStorage.
  return encodePortableInstanceShare(payload);
}

export function encodePortableInstanceShare(payload: InstanceSharePayload) {
  return `${PORTABLE_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

export function decodeInstanceShare(code: string): InstanceSharePayload | null {
  const clean = code.trim().replace(/^modstack:\/\//i, "");
  const registry = loadRegistry();
  if (registry[clean]) return registry[clean];
  const raw = clean.startsWith(PORTABLE_PREFIX)
    ? clean.slice(PORTABLE_PREFIX.length)
    : clean.startsWith(PREFIX)
      ? clean.slice(PREFIX.length)
      : clean;
  try {
    const parsed = JSON.parse(fromBase64Url(raw)) as any;
    if (parsed.type !== "modstack-instance" || (parsed.version !== 1 && parsed.version !== 2)) return null;
    if (!parsed.title || !parsed.minecraft_version || !parsed.loader) return null;
    return { ...parsed, version: 2, mods: Array.isArray(parsed.mods) ? parsed.mods : [] } as InstanceSharePayload;
  } catch {
    return null;
  }
}

export function createInstanceShareMessage(instance: LocalInstance, payload = createInstanceSharePayload(instance)) {
  const code = encodePortableInstanceShare(payload);
  return `[[MODSTACK_INSTANCE:${code}]]\nTe comparto mi instancia: ${instance.title}`;
}

export function parseInstanceShareMessage(content: string) {
  const match = content.match(MESSAGE_RE);
  if (!match) return null;
  const payload = decodeInstanceShare(match[1]);
  if (!payload) return null;
  return { payload, code: match[1] };
}

export function cleanInstanceShareMessage(content: string) {
  return content.replace(MESSAGE_RE, "").trim();
}

export async function importSharedInstance(payload: InstanceSharePayload) {
  const now = Date.now();
  const id = `${slugify(payload.title) || "shared-instance"}-${now}`;
  const installDir = await invoke<string>("get_install_dir");
  const instanceDir = await join(installDir, "instances", id);
  const iconPath = payload.icon ? await join(instanceDir, payload.icon.filename) : null;
  const backgroundPath = payload.background ? await join(instanceDir, payload.background.filename) : null;
  const instance: LocalInstance = {
    id,
    title: payload.title,
    minecraft_version: payload.minecraft_version,
    loader: payload.loader,
    icon_path: iconPath,
    background_path: backgroundPath,
    created_at: now,
  };
  const created = await invoke<LocalInstance>("add_local_instance", {
    instance,
    iconSrc: null,
    backgroundSrc: null,
  });
  if (payload.icon && created.icon_path) {
    await writeFile(created.icon_path, new Uint8Array(payload.icon.bytes));
  }
  if (payload.background && created.background_path) {
    await writeFile(created.background_path, new Uint8Array(payload.background.bytes));
  }
  const sharedMods = Array.isArray(payload.mods) ? payload.mods : [];
  if (sharedMods.length) {
    const modsDir = await join(installDir, "instances", id, "mods");
    await mkdir(modsDir, { recursive: true });
    const failures: string[] = [];
    for (const mod of sharedMods) {
      const filename = mod.filename.split(/[\\/]/).pop() || "";
      if (!/^[^/\\]+\.(?:jar|zip)(?:\.disabled)?$/i.test(filename)) continue;
      const filePath = await join(modsDir, filename);
      try {
        if (mod.download_url && isSupportedModDownload(mod.download_url)) {
          const targetFilename = filename.endsWith(".disabled") ? filename.slice(0, -9) : filename;
          const downloadPath = await join(modsDir, targetFilename);
          await invoke("download_mod", { url: mod.download_url, path: downloadPath });
          if (filename.endsWith(".disabled")) {
            const bytes = await readFile(downloadPath);
            await writeFile(filePath, bytes);
            await remove(downloadPath);
          }
        } else if (mod.contents) {
          await writeFile(filePath, base64UrlToBytes(mod.contents));
        } else {
          throw new Error("Sem arquivo ou URL de download");
        }
      } catch {
        failures.push(filename);
      }
    }
    if (failures.length) {
      throw new Error(`Instância criada, mas não foi possível importar ${failures.length} mod(s): ${failures.slice(0, 5).join(", ")}`);
    }
  }
  return created;
}

function isSupportedModDownload(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "cdn.modrinth.com" || url.hostname.endsWith(".modrinth.com") || url.hostname.endsWith(".forgecdn.net"));
  } catch { return false; }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function loadRegistry(): Record<string, InstanceSharePayload> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

