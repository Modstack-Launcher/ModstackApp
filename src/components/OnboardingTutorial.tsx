import { useEffect, useState } from "react";
import {
  IconBox,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceGamepad2,
  IconDownload,
  IconLanguage,
  IconMusic,
  IconPhoto,
  IconPlayerPlayFilled,
  IconServer,
  IconSparkles,
  IconUsers,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { languageOptions, useLanguage, type LauncherLanguage } from "../utils/languageContext";

const STORAGE_KEY = "modstack.onboarding.v1.done";

type Step = {
  title: string;
  body: string;
  action: string;
  icon: typeof IconSparkles;
};

type Copy = {
  eyebrow: string;
  introTitle: string;
  introBody: string;
  chooseLanguage: string;
  skip: string;
  start: string;
  next: string;
  back: string;
  finish: string;
  ready: string;
  previewTitle: string;
  previewSubtitle: string;
  steps: Step[];
};

const copy: Record<LauncherLanguage, Copy> = {
  en: {
    eyebrow: "Welcome",
    introTitle: "Set up Modstack",
    introBody: "A quick first-run guide so everything feels familiar before you start playing.",
    chooseLanguage: "Choose language",
    skip: "Skip",
    start: "Start guide",
    next: "Next",
    back: "Back",
    finish: "Done",
    ready: "Ready to launch",
    previewTitle: "Your launcher, organized",
    previewSubtitle: "Instances, content, friends, music, servers, and clips in one place.",
    steps: [
      { title: "Instances", body: "Create custom profiles, import codes, and open each instance to manage content.", action: "Library is your Minecraft hub.", icon: IconBox },
      { title: "Modpacks", body: "Browse mods, resource packs, shaders, and packs from inside each instance.", action: "Use Browse content to install.", icon: IconDownload },
      { title: "Skins", body: "Save skins, pick an active one, and keep your player preview updated.", action: "Works for offline and Microsoft accounts.", icon: IconPhoto },
      { title: "Social", body: "Edit your profile, add friends, chat, and share played instances or playlists.", action: "Your profile lives in Social.", icon: IconUsers },
      { title: "Music and servers", body: "Search music, import playlists, discover servers, and keep the player ready.", action: "Play while you manage instances.", icon: IconMusic },
      { title: "Clips and settings", body: "Record recent moments, tune Java, RAM, resolution, downloads, and Discord RPC.", action: "Adjust only what you need.", icon: IconDeviceGamepad2 },
    ],
  },
  es: {
    eyebrow: "Bienvenido",
    introTitle: "Prepara Modstack",
    introBody: "Una guia rapida de primera entrada para que sepas donde esta todo antes de jugar.",
    chooseLanguage: "Elige idioma",
    skip: "Skip",
    start: "Iniciar guia",
    next: "Siguiente",
    back: "Atras",
    finish: "Listo",
    ready: "Listo para jugar",
    previewTitle: "Tu launcher, ordenado",
    previewSubtitle: "Instancias, contenido, amigos, musica, servidores y clips en un solo lugar.",
    steps: [
      { title: "Instancias", body: "Crea perfiles custom, importa codigos y abre cada instancia para manejar contenido.", action: "La libreria es tu centro de Minecraft.", icon: IconBox },
      { title: "Modpacks", body: "Busca mods, resource packs, shaders y packs desde dentro de cada instancia.", action: "Usa Browse content para instalar.", icon: IconDownload },
      { title: "Skins", body: "Guarda skins, elige una activa y mantiene actualizado tu preview.", action: "Sirve para offline y Microsoft.", icon: IconPhoto },
      { title: "Social", body: "Edita tu perfil, agrega amigos, chatea y comparte instancias o playlists.", action: "Tu perfil vive en Social.", icon: IconUsers },
      { title: "Musica y servers", body: "Busca musica, importa playlists, descubre servidores y usa el reproductor.", action: "Escucha mientras manejas instancias.", icon: IconMusic },
      { title: "Clips y ajustes", body: "Graba momentos recientes, cambia Java, RAM, resolucion, descargas y Discord RPC.", action: "Ajusta solo lo que necesites.", icon: IconDeviceGamepad2 },
    ],
  },
  pt: {
    eyebrow: "Bem-vindo",
    introTitle: "Prepare o Modstack",
    introBody: "Um guia rapido de primeira entrada para voce saber onde tudo fica antes de jogar.",
    chooseLanguage: "Escolha idioma",
    skip: "Pular",
    start: "Iniciar guia",
    next: "Proximo",
    back: "Voltar",
    finish: "Pronto",
    ready: "Pronto para jogar",
    previewTitle: "Seu launcher, organizado",
    previewSubtitle: "Instancias, conteudo, amigos, musica, servidores e clips em um lugar.",
    steps: [
      { title: "Instancias", body: "Crie perfis custom, importe codigos e abra cada instancia para gerenciar conteudo.", action: "A biblioteca e seu centro de Minecraft.", icon: IconBox },
      { title: "Modpacks", body: "Busque mods, resource packs, shaders e packs dentro de cada instancia.", action: "Use Browse content para instalar.", icon: IconDownload },
      { title: "Skins", body: "Salve skins, escolha uma ativa e mantenha seu preview atualizado.", action: "Funciona para offline e Microsoft.", icon: IconPhoto },
      { title: "Social", body: "Edite seu perfil, adicione amigos, converse e compartilhe instancias ou playlists.", action: "Seu perfil fica em Social.", icon: IconUsers },
      { title: "Musica e servers", body: "Busque musica, importe playlists, descubra servidores e use o player.", action: "Ouça enquanto gerencia instancias.", icon: IconMusic },
      { title: "Clips e ajustes", body: "Grave momentos recentes, mude Java, RAM, resolucao, downloads e Discord RPC.", action: "Ajuste so o que precisar.", icon: IconDeviceGamepad2 },
    ],
  },
};

const previewIcons = [IconBox, IconDownload, IconUsers, IconMusic, IconServer, IconVideo];

export default function OnboardingTutorial({ enabled }: { enabled: boolean }) {
  const language = useLanguage((state) => state.language);
  const setLanguage = useLanguage((state) => state.setLanguage);
  const [visible, setVisible] = useState(false);
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const c = copy[language];
  const current = c.steps[step];
  const CurrentIcon = current?.icon ?? IconSparkles;
  const isLast = step === c.steps.length - 1;

  useEffect(() => {
    if (!enabled || typeof localStorage === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY) === "1") return;
    setVisible(true);
  }, [enabled]);

  const close = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  const next = () => {
    if (!started) {
      setStarted(true);
      return;
    }
    if (isLast) close();
    else setStep((value) => value + 1);
  };

  const back = () => {
    if (!started) return;
    if (step === 0) setStarted(false);
    else setStep((value) => value - 1);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/72 p-5 backdrop-blur-xl">
      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-[20px] border border-white/[0.09] bg-[#0f1014] text-white shadow-[0_36px_130px_-48px_rgba(0,0,0,0.95)] md:grid-cols-[0.92fr_1.08fr]">
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 z-20 grid size-9 place-items-center rounded-xl text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label={c.skip}
        >
          <IconX className="size-4" />
        </button>

        <div className="relative min-h-[430px] overflow-hidden border-b border-white/[0.07] bg-[#08090d] p-6 md:border-b-0 md:border-r">
          <div className="absolute inset-0 opacity-80 [background:radial-gradient(circle_at_20%_10%,color-mix(in_srgb,var(--color-accent)_32%,transparent),transparent_34%),linear-gradient(150deg,#111522,#07080b_64%)]" />
          <div className="relative flex h-full flex-col">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-accent">{c.eyebrow}</p>
              <h2 className="mt-2 max-w-xs text-3xl font-black tracking-tight">{started ? current.title : c.introTitle}</h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-white/52">{started ? current.body : c.introBody}</p>
            </div>

            <div className="mt-8 rounded-2xl border border-white/[0.08] bg-black/28 p-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-white/80">{c.previewTitle}</p>
                  <p className="mt-1 text-xs text-white/36">{c.previewSubtitle}</p>
                </div>
                <div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                  {started ? <CurrentIcon className="size-5" /> : <IconSparkles className="size-5" />}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2">
                {previewIcons.map((Icon, index) => {
                  const active = started ? index === step % previewIcons.length : index === 0;
                  return (
                    <div
                      key={index}
                      className={`grid h-16 place-items-center rounded-xl border transition-colors ${
                        active
                          ? "border-accent/35 bg-accent/18 text-accent"
                          : "border-white/[0.06] bg-white/[0.035] text-white/28"
                      }`}
                    >
                      <Icon className="size-6" />
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: started ? `${((step + 1) / c.steps.length) * 100}%` : "12%" }}
                />
              </div>
            </div>

            <div className="mt-auto pt-6">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/46">
                <IconPlayerPlayFilled className="size-3.5 text-accent" />
                {c.ready}
              </p>
            </div>
          </div>
        </div>

        <div className="relative flex min-h-[430px] flex-col p-6">
          {!started ? (
            <div className="flex flex-1 flex-col justify-center">
              <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-accent/25 bg-accent/16 text-accent">
                <IconLanguage className="size-6" />
              </div>
              <h3 className="text-xl font-black">{c.chooseLanguage}</h3>
              <div className="mt-4 grid gap-2">
                {languageOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setLanguage(option.value as LauncherLanguage)}
                    className={`flex h-12 items-center justify-between rounded-xl border px-4 text-left text-sm font-black transition-colors ${
                      language === option.value
                        ? "border-accent/45 bg-accent/18 text-white"
                        : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span>{option.label}</span>
                    {language === option.value && <IconCheck className="size-4 text-accent" />}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-center">
              <p className="text-[11px] font-black uppercase tracking-[0.26em] text-white/28">
                {step + 1}/{c.steps.length}
              </p>
              <div className="mt-4 flex items-center gap-4">
                <div className="grid size-14 place-items-center rounded-2xl bg-accent/18 text-accent">
                  <CurrentIcon className="size-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-black tracking-tight">{current.title}</h3>
                  <p className="mt-1 text-sm text-white/42">{current.action}</p>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5">
                <p className="text-sm leading-6 text-white/62">{current.body}</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
            <button
              type="button"
              onClick={close}
              className="rounded-xl px-4 py-2 text-sm font-bold text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              {c.skip}
            </button>

            <div className="flex items-center gap-2">
              {started && (
                <button
                  type="button"
                  onClick={back}
                  className="grid size-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
                  aria-label={c.back}
                >
                  <IconChevronLeft className="size-5" />
                </button>
              )}
              <button
                type="button"
                onClick={next}
                className="flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-accent-foreground transition-transform hover:-translate-y-0.5"
              >
                {!started ? c.start : isLast ? c.finish : c.next}
                <IconChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
