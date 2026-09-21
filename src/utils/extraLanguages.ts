export const extraLanguageOptions = [
  {
    "value": "ru",
    "label": "Русский",
    "english": "Russian"
  },
  {
    "value": "ja",
    "label": "日本語",
    "english": "Japanese"
  },
  {
    "value": "zh",
    "label": "简体中文",
    "english": "Chinese"
  },
  {
    "value": "ko",
    "label": "한국어",
    "english": "Korean"
  },
  {
    "value": "de",
    "label": "Deutsch",
    "english": "German"
  },
  {
    "value": "fr",
    "label": "Français",
    "english": "French"
  },
  {
    "value": "it",
    "label": "Italiano",
    "english": "Italian"
  },
  {
    "value": "ar",
    "label": "العربية",
    "english": "Arabic"
  },
  {
    "value": "hi",
    "label": "हिन्दी",
    "english": "Hindi"
  },
  {
    "value": "tr",
    "label": "Türkçe",
    "english": "Turkish"
  },
  {
    "value": "pl",
    "label": "Polski",
    "english": "Polish"
  },
  {
    "value": "uk",
    "label": "Українська",
    "english": "Ukrainian"
  },
  {
    "value": "nl",
    "label": "Nederlands",
    "english": "Dutch"
  },
  {
    "value": "id",
    "label": "Bahasa Indonesia",
    "english": "Indonesian"
  },
  {
    "value": "vi",
    "label": "Tiếng Việt",
    "english": "Vietnamese"
  }
] as const;
export type ExtraLanguage = typeof extraLanguageOptions[number]["value"];
