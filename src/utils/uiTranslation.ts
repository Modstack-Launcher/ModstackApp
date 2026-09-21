import { useLanguage, type TranslationKey } from "./languageContext";

export function uiText(key: TranslationKey, values: Record<string, unknown> = {}): string {
  return useLanguage.getState().t(key).replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : token);
}

export function useUiLanguage() {
  return useLanguage(state => state.language);
}
