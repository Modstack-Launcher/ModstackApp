import { open } from '@tauri-apps/plugin-shell'

const API = (import.meta.env.VITE_MODSTACK_API_URL || 'https://api.modstack.online').replace(/\/$/, '')

export const MODSTACK_API_URL = API
export const MODSTACK_WS_URL = API.replace(/^http/, 'ws') + '/ws'

export interface ModstackUser {
  id: string
  username: string
  avatar: string | null
}

export type PresenceStatus = 'online' | 'playing' | 'offline'
export type PresenceActivityKind = 'online' | 'playing' | 'listening' | 'offline'

export interface ModstackFriend extends ModstackUser {
  status: PresenceStatus
  activity: string | null
}

export interface ParsedPresence {
  kind: PresenceActivityKind
  text: string | null
}

const PRESENCE_PREFIXES = [
  { kind: 'playing' as const, pattern: /^(playing|jugando|jogando)\s*:\s*/i },
  { kind: 'listening' as const, pattern: /^(listening|escuchando|ouvindo)\s*:\s*/i },
]

export function encodePresenceActivity(kind: Exclude<PresenceActivityKind, 'online' | 'offline'>, text: string) {
  const value = text.trim()
  if (!value) return null
  return `${kind === 'listening' ? 'Escuchando' : 'Jugando'}: ${value}`
}

export function parsePresence(status: PresenceStatus, activity: string | null): ParsedPresence {
  if (status === 'offline') return { kind: 'offline', text: null }
  const value = activity?.trim()
  if (!value) return { kind: 'online', text: null }

  for (const prefix of PRESENCE_PREFIXES) {
    if (prefix.pattern.test(value)) {
      return { kind: prefix.kind, text: value.replace(prefix.pattern, '').trim() || null }
    }
  }

  if (/\S\s[-–—]\s\S/.test(value)) {
    return { kind: 'listening', text: value }
  }

  return { kind: status === 'playing' ? 'playing' : 'online', text: value }
}

export interface FriendRequest {
  id: number
  userId: string
  username: string
  avatar: string | null
}

export interface ChatMessage {
  id: number
  senderId: string
  receiverId: string
  content: string
  createdAt: string
  editedAt: string | null
  readAt: string | null
  replyToId?: number | null
  replyTo?: ChatMessage | null
  reactions?: { emoji: string; count: number; me?: boolean }[]
  sender?: ModstackUser | null
}

export interface ModstackSession {
  accessToken: string
  refreshToken: string
  user: ModstackUser
}

const STORAGE_KEY = 'modstack.session'

export function getSession(): ModstackSession | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

export function saveSession(session: ModstackSession | null) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  else localStorage.removeItem(STORAGE_KEY)
}

export function avatarUrl(avatar: string | null): string | null {
  if (!avatar) return null
  return avatar.startsWith('http') ? avatar : `${API}${avatar}`
}

let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const session = getSession()
    if (!session) return null
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      })
      if (!res.ok) {
        if (res.status === 401) {
          saveSession(null)
          window.dispatchEvent(new Event('modstack:session-expired'))
        }
        return null
      }
      const data = await res.json()
      saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user })
      return data.accessToken as string
    } catch {
      return null
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function getFreshAccessToken(): Promise<string | null> {
  return refreshAccessToken()
}

async function apiFetch(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const session = getSession()
  const headers = new Headers(options.headers)
  if (session) headers.set('Authorization', `Bearer ${session.accessToken}`)
  if (options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json')

  const res = await fetch(`${API}${path}`, { ...options, headers })
  if (res.status === 401 && retry && session) {
    const token = await refreshAccessToken()
    if (token) return apiFetch(path, options, false)
  }
  return res
}

async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options)
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`)
  return data as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const modstack = {
  async loginWithProvider(
    provider: 'google' | 'discord',
    signal?: AbortSignal,
  ): Promise<ModstackUser> {
    const deviceRes = await fetch(`${API}/auth/device`, { method: 'POST' })
    if (!deviceRes.ok) throw new Error('Could not start the login')
    const { code, expiresIn } = await deviceRes.json()

    await open(`${API}/auth/${provider}?device=${code}`)

    const deadline = Date.now() + expiresIn * 1000
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Login cancelled')
      await sleep(2500)
      const res = await fetch(`${API}/auth/device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) continue
      const data = await res.json()
      if (data.status === 'complete') {
        saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user })
        return data.user as ModstackUser
      }
      if (data.status === 'expired') break
    }
    throw new Error('Login expired, please try again')
  },

  async logout() {
    const session = getSession()
    saveSession(null)
    if (session) {
      fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).catch(() => {})
    }
  },

  me: () => apiJson<{ user: ModstackUser }>('/users/me'),

  searchUsers: (q: string) =>
    apiJson<{ users: ModstackUser[] }>(`/users/search?q=${encodeURIComponent(q)}`),

  getFriends: () => apiJson<{ friends: ModstackFriend[] }>('/friends'),

  getRequests: () =>
    apiJson<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/friends/requests'),

  sendRequest: (username: string) =>
    apiJson<{ accepted: boolean }>('/friends/requests', {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  acceptRequest: (id: number) =>
    apiJson<{ accepted: boolean; friend: ModstackUser }>(`/friends/requests/${id}/accept`, { method: 'POST' }),

  deleteRequest: (id: number) => apiJson<void>(`/friends/requests/${id}`, { method: 'DELETE' }),

  removeFriend: (userId: string) => apiJson<void>(`/friends/${userId}`, { method: 'DELETE' }),

  getMessages: (userId: string, before?: number) =>
    apiJson<{ messages: ChatMessage[] }>(
      `/chat/${userId}/messages${before ? `?before=${before}` : ''}`,
    ),

  getGlobalMessages: (before?: number) =>
    apiJson<{ messages: ChatMessage[] }>(
      `/chat/global/messages${before ? `?before=${before}` : ''}`,
    ),

  getUnread: () => apiJson<{ unread: { userId: string; count: number }[] }>('/chat/unread'),

  sendMessageRest: (userId: string, content: string, replyToId?: number | null) =>
    apiJson<{ message: ChatMessage }>(`/chat/${userId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, replyToId: replyToId ?? null }),
    }),

  sendGlobalMessageRest: (content: string, replyToId?: number | null) =>
    apiJson<{ message: ChatMessage }>('/chat/global/messages', {
      method: 'POST',
      body: JSON.stringify({ content, replyToId: replyToId ?? null }),
    }),

  reactToMessage: (messageId: number, emoji: string) =>
    apiJson<{ message?: ChatMessage; reactions?: ChatMessage['reactions'] }>(`/chat/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  editMessage: async (messageId: number, content: string): Promise<{ message: ChatMessage | null }> => {
    const res = await apiFetch(`/chat/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    })
    if (res.status === 404 || res.status === 204) return { message: null }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || `Error ${res.status}`)
    return data as { message: ChatMessage }
  },

  deleteMessage: async (messageId: number): Promise<void> => {
    const res = await apiFetch(`/chat/messages/${messageId}`, { method: 'DELETE' })
    if (res.status === 404 || res.status === 204) return
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || `Error ${res.status}`)
  },

  markRead: (userId: string) => apiJson<void>(`/chat/${userId}/read`, { method: 'POST' }),
}
