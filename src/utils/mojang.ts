export type SkinModel = "slim" | "classic";

import { invoke } from "@tauri-apps/api/core";

export async function getMinecraftProfile(username: string) {
  const raw = await invoke<string>("get_minecraft_profile", { username });
  return JSON.parse(raw);
}

export function getSkinModelFromProfile(profile: any): SkinModel {
  try {
    const value = profile?.properties?.[0]?.value;
    if (!value) return "classic";

    const decoded = JSON.parse(atob(value));

    const model = decoded?.textures?.SKIN?.metadata?.model;

    return model === "slim" ? "slim" : "classic";
  } catch {
    return "classic";
  }
}

export function getSkinUrlFromProfile(profile: any): string {
  try {
    const value = profile?.properties?.[0]?.value;
    if (!value) return "/steve.png";

    const decoded = JSON.parse(atob(value));
    return decoded?.textures?.SKIN?.url || "/steve.png";
  } catch {
    return "/steve.png";
  }
}

export function getSkinUrl(username: string) {
  return `https://mineskin.eu/skin/${username}`;
}