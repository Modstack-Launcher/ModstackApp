import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ClipOverlayWindow from "./components/ClipOverlayWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { NavigationProvider } from "./hooks/useNavigation";
import { SettingsProvider } from "./stores/settingsContext";
import { AuthProvider } from "./stores/authContext";
import { InstanceProvider } from "./stores/instanceContext";
import { LaunchProvider } from "./stores/launchContext";
import { ModstackProvider } from "./stores/modstackContext";

const isClipOverlay =
  getCurrentWindow().label.startsWith("clip_overlay") ||
  window.location.search.includes("clip_overlay=1");

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {isClipOverlay ? (
      <ClipOverlayWindow />
    ) : (
      <SettingsProvider>
        <AuthProvider>
          <LaunchProvider>
            <InstanceProvider>
              <ModstackProvider>
                <NavigationProvider initialPath="home">
                  <App />
                </NavigationProvider>
              </ModstackProvider>
            </InstanceProvider>
          </LaunchProvider>
        </AuthProvider>
      </SettingsProvider>
    )}
  </StrictMode>,
);
