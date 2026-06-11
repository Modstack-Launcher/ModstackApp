import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

import { NavigationProvider } from "./hooks/useNavigation";
import { SettingsProvider } from "./stores/settingsContext";
import { AuthProvider } from "./stores/authContext";
import { InstanceProvider } from "./stores/instanceContext";
import { LaunchProvider } from "./stores/launchContext";
import { ModstackProvider } from "./stores/modstackContext";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
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
  </StrictMode>,
);
