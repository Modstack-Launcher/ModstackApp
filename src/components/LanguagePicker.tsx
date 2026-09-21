import { useState } from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { languageOptions, useLanguage, useLauncherTranslation } from "../utils/languageContext";

export default function LanguagePicker() {
  const { language, setLanguage } = useLanguage();
  const t = useLauncherTranslation();
  const [expanded, setExpanded] = useState(false);
  const extraSelected = !["en", "es", "pt"].includes(language);

  return <div className="w-full">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-medium">{t("settings.language.label")}</p><p className="mt-0.5 text-xs text-muted">{t("settings.language.description")}</p></div>
      <div className="relative flex flex-wrap items-center gap-1 rounded-[10px] border border-border bg-surface p-1">
        {languageOptions.slice(0, 3).map(option => <button type="button" key={option.value} onClick={() => setLanguage(option.value)} aria-pressed={language === option.value} className={`flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold transition-colors ${language === option.value ? "bg-accent text-accent-foreground" : "text-muted hover:bg-white/5 hover:text-foreground"}`}>{language === option.value && <IconCheck size={14} />}{option.label}</button>)}
        <button type="button" aria-expanded={expanded} aria-controls="more-languages-list" onClick={() => setExpanded(value => !value)} className={`flex h-8 items-center gap-1 rounded-[8px] px-3 text-sm font-semibold ${extraSelected || expanded ? "bg-accent/15 text-accent" : "text-muted hover:bg-white/5 hover:text-foreground"}`}>+ more{extraSelected && <span className="ml-1 text-xs">· {languageOptions.find(option => option.value === language)?.label}</span>}<IconChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} /></button>
        {expanded && <div id="more-languages-list" className="more-languages-panel" role="listbox" aria-label={t("settings.language.label")}>
          {languageOptions.slice(3).map(option => <button type="button" role="option" aria-selected={language === option.value} key={option.value} lang={option.value} onClick={() => { setLanguage(option.value); setExpanded(false); }} className={`more-language-option ${language === option.value ? "is-selected" : ""}`}><span>{option.label}</span>{language === option.value && <IconCheck size={15} />}</button>)}
        </div>}
      </div>
    </div>
  </div>;
}
