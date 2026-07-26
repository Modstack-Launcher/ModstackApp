const BASE_URL = import.meta.env.VITE_MODSTACK_API_URL ?? "https://api.modstack.app";

async function req<T>(method: string, path: string, token?: string | null, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return null as T;
}

export interface AuthResponse {
  token: string;
  username: string;
  uuid: string;
  role: string;
}

export interface ServerDto {
  name: string;
  mcVersion: string;
  software: string;
  host: string;
  port: number;
  maxPlayers: number;
  isPublic: boolean;
  motd: string;
}

export interface ServerResponseDto {
  id: string;
  name: string;
  host: string;
  port: number;
  maxPlayers: number;
  onlinePlayers: number;
  isPublic: boolean;
  mcVersion: string;
  software: string;
  motd: string;
  ownerUuid: string;
  createdAt: string;
}

export function apiLogin(uuid: string, username: string, microsoftToken: string): Promise<AuthResponse> {
  return req("POST", "/api/v1/auth/login", null, { uuid, username, microsoftToken });
}

export function apiGetMe(token: string): Promise<AuthResponse> {
  return req("GET", "/api/v1/auth/me", token);
}

export function apiRegisterServer(token: string, dto: ServerDto): Promise<ServerResponseDto> {
  return req("POST", "/api/v1/servers", token, dto);
}

export function apiHeartbeat(token: string, serverId: string, onlinePlayers: number): Promise<void> {
  return req("POST", `/api/v1/servers/${serverId}/heartbeat`, token, { onlinePlayers });
}

export function apiDeleteServer(token: string, serverId: string): Promise<void> {
  return req("DELETE", `/api/v1/servers/${serverId}`, token);
}

export function apiGetPublicServers(): Promise<ServerResponseDto[]> {
  return req("GET", "/api/v1/servers/public");
}

export function apiGetMyServers(token: string): Promise<ServerResponseDto[]> {
  return req("GET", "/api/v1/servers/mine", token);
}
