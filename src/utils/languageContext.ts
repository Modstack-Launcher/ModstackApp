import { create } from "zustand";
import en from "../locales/en.json";
import { extraLanguageOptions, type ExtraLanguage } from "./extraLanguages";

export type LauncherLanguage = "en" | "es" | "pt" | ExtraLanguage;
export type TranslationKey = keyof typeof en;
const STORAGE_KEY = "modstack.language";
const catalogs = import.meta.glob<{ default: Record<string, string> }>("../locales/*.json", { eager: true });
const dictionaries = Object.fromEntries(Object.entries(catalogs).filter(([path]) => !path.endsWith("ui-source.json")).map(([path, module]) => [path.split("/").pop()!.replace(".json", ""), module.default])) as Record<LauncherLanguage, Record<string, string>>;

export const languageOptions: { value: LauncherLanguage; label: string }[] = [
  { value: "en", label: "English" }, { value: "es", label: "Español" }, { value: "pt", label: "Português" }, ...extraLanguageOptions,
];
function loadLanguage(): LauncherLanguage {
  if (typeof localStorage === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  return languageOptions.some(option => option.value === stored) ? stored as LauncherLanguage : "en";
}
function translate(language: LauncherLanguage, key: TranslationKey): string {
  return dictionaries[language]?.[key] || en[key];
}
interface LanguageState {
  language: LauncherLanguage;
  setLanguage: (language: LauncherLanguage) => void;
  t: (key: TranslationKey) => string;
}
export const useLanguage = create<LanguageState>((set, get) => ({
  language: loadLanguage(),
  setLanguage: language => {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, language);
    if (typeof document !== "undefined") document.documentElement.lang = language;
    set({ language });
  },
  t: key => translate(get().language, key),
}));
if (typeof document !== "undefined") document.documentElement.lang = useLanguage.getState().language;
export function useLauncherTranslation() {
  const language = useLanguage(state => state.language);
  return (key: TranslationKey) => translate(language, key);
}
