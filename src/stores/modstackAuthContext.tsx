import React, { createContext, useContext, useEffect, useState } from "react";
import { apiGetMe, apiLogin, AuthResponse } from "../lib/modstackApi";
import { useAuth } from "./authContext";

interface ModstackAuthCtx {
  token: string | null;
  profile: AuthResponse | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<ModstackAuthCtx>({
  token: null,
  profile: null,
  loading: false,
  error: null,
  login: async () => {},
  logout: () => {},
});

export function ModstackAuthProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    if (!account?.minecraftProfile || !account?.accessToken) {
      setError("debes iniciar sesion con Microsoft primero");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const uuid = account.minecraftProfile.id;
      const name = account.minecraftProfile.name;
      const msToken = account.accessToken;
      const resp = await apiLogin(uuid, name, msToken);
      setToken(resp.token);
      setProfile(resp);
    } catch (err: any) {
      setError(err?.message ?? "error al conectar con Modstack");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setProfile(null);
  }

  useEffect(() => {
    if (!account?.minecraftProfile || token) return;
    login();
  }, [account?.minecraftProfile]);

  return (
    <Ctx.Provider value={{ token, profile, loading, error, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useModstackAuth() {
  return useContext(Ctx);
}
