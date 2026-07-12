import { create } from "zustand";

interface ModrinthHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  author: string;
  follows?: number;
  categories?: string[];
  versions?: string[];
  date_modified?: string;
}

type InstanceTab = "all" | "modpacks" | "local" | "custom";

interface InstancesNavState {
  pendingTab: InstanceTab | null;
  pendingModpackHit: ModrinthHit | null;
  pendingCreate: { version?: string; name?: string } | null;
  requestTab: (tab: InstanceTab) => void;
  requestModpack: (hit: ModrinthHit) => void;
  requestCreate: (payload?: { version?: string; name?: string }) => void;
  consumeTab: () => InstanceTab | null;
  consumeModpackHit: () => ModrinthHit | null;
  consumeCreate: () => { version?: string; name?: string } | null;
}

export const useInstancesNav = create<InstancesNavState>((set, get) => ({
  pendingTab: null,
  pendingModpackHit: null,
  pendingCreate: null,
  requestTab: (tab) => set({ pendingTab: tab, pendingModpackHit: null, pendingCreate: null }),
  requestModpack: (hit) => set({ pendingTab: "modpacks", pendingModpackHit: hit, pendingCreate: null }),
  requestCreate: (payload = {}) => set({ pendingTab: "all", pendingModpackHit: null, pendingCreate: payload }),
  consumeTab: () => {
    const tab = get().pendingTab;
    set({ pendingTab: null });
    return tab;
  },
  consumeModpackHit: () => {
    const hit = get().pendingModpackHit;
    set({ pendingModpackHit: null });
    return hit;
  },
  consumeCreate: () => {
    const payload = get().pendingCreate;
    set({ pendingCreate: null });
    return payload;
  },
}));
