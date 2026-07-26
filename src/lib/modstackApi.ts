const BASE_URL = "https://api.modstack.gg";

export interface AuthResponse {
  token: string;
  userId: string;
  minecraftUuid: string;
  minecraftName: string;
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
  mcVersion: string;
  software: string;
  host: string;
  port: number;
  maxPlayers: number;
  onlinePlayers: number;
  isPublic: boolean;
  motd: string;
  ownerId: string;
  ownerName: string;
  lastHeartbeat: string;
}

export interface HeartbeatRequest {
  onlinePlayers: number;
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function apiLogin(
  minecraftUuid: string,
  minecraftName: string,
  microsoftToken: string
): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minecraftUuid, minecraftName, microsoftToken }),
  });
  if (!res.ok) throw new Error(`auth failed: ${res.status}`);
  return res.json();
}

export async function apiGetMe(token: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/me`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`get me failed: ${res.status}`);
  return res.json();
}

export async function apiRegisterServer(
  token: string,
  dto: ServerDto
): Promise<ServerResponseDto> {
  const res = await fetch(`${BASE_URL}/api/v1/servers`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(dto),
  });
  if (!res.ok) throw new Error(`register server failed: ${res.status}`);
  return res.json();
}

export async function apiHeartbeat(
  token: string,
  serverId: string,
  onlinePlayers: number
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/servers/${serverId}/heartbeat`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ onlinePlayers } as HeartbeatRequest),
  });
  if (!res.ok) throw new Error(`heartbeat failed: ${res.status}`);
}

export async function apiDeleteServer(
  token: string,
  serverId: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/servers/${serverId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`delete server failed: ${res.status}`);
}

export async function apiGetPublicServers(
  token: string
): Promise<ServerResponseDto[]> {
  const res = await fetch(`${BASE_URL}/api/v1/servers/public`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`get public servers failed: ${res.status}`);
  return res.json();
}

export async function apiGetMyServers(
  token: string
): Promise<ServerResponseDto[]> {
  const res = await fetch(`${BASE_URL}/api/v1/servers/mine`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`get my servers failed: ${res.status}`);
  return res.json();
}
