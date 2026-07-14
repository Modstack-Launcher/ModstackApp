import { invoke } from "@tauri-apps/api/core";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { slugify, type LocalInstance } from "./localInstances";

export interface InstanceSharePayload {
  type: "modstack-instance";
  version: 1;
  title: string;
  minecraft_version: string;
  loader: LocalInstance["loader"];
  created_at: number;
  icon?: SharedAsset | null;
  background?: SharedAsset | null;
}

interface SharedAsset {
  filename: string;
  bytes: number[];
}

const PREFIX = "MS-";
const PORTABLE_PREFIX = "MSP-";
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
    version: 1,
    title: instance.title,
    minecraft_version: instance.minecraft_version,
    loader: instance.loader,
    created_at: Date.now(),
  };
}

export async function createInstanceSharePayloadWithAssets(instance: LocalInstance): Promise<InstanceSharePayload> {
  const payload = createInstanceSharePayload(instance);
  payload.icon = await readAsset(instance.icon_path, "icon");
  payload.background = await readAsset(instance.background_path, "background");
  return payload;
}

export function encodeInstanceShare(payload: InstanceSharePayload) {
  const registry = loadRegistry();
  let code = "";
  do {
    code = `${PREFIX}${randomCode(6)}`;
  } while (registry[code]);
  registry[code] = payload;
  saveRegistry(registry);
  return code;
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
    const parsed = JSON.parse(fromBase64Url(raw)) as Partial<InstanceSharePayload>;
    if (parsed.type !== "modstack-instance" || parsed.version !== 1) return null;
    if (!parsed.title || !parsed.minecraft_version || !parsed.loader) return null;
    return parsed as InstanceSharePayload;
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
  return created;
}

async function readAsset(path: string | null | undefined, fallback: string): Promise<SharedAsset | null> {
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    const ext = path.split(/[\\/]/).pop()?.split(".").pop() || "png";
    return { filename: `${fallback}.${ext}`, bytes: Array.from(bytes) };
  } catch {
    return null;
  }
}

function randomCode(length: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value;
}

function loadRegistry(): Record<string, InstanceSharePayload> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveRegistry(registry: Record<string, InstanceSharePayload>) {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
}
