import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from 'react'
import {
  modstack,
  getSession,
  getFreshAccessToken,
  MODSTACK_WS_URL,
  type ModstackUser,
  type ModstackFriend,
  type FriendRequest,
  type ChatMessage,
  type PresenceStatus,
  encodePresenceActivity,
} from '../utils/modstack'
import { useLaunch } from './launchContext'
import { useInstance } from './instanceContext'
import { getCurrentTrack, useMusic } from '../utils/musicContext'

interface ModstackContextValue {
  account: ModstackUser | null
  isWaitingLogin: boolean
  connected: boolean
  friends: ModstackFriend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  unread: Record<string, number>
  messages: Record<string, ChatMessage[]>
  globalMessages: ChatMessage[]
  login: (provider: 'google' | 'discord') => Promise<void>
  logout: () => void
  updateProfile: (profile: { username?: string; bio?: string }) => Promise<ModstackUser>
  uploadAvatar: (file: File) => Promise<ModstackUser>
  refreshSocial: () => Promise<void>
  sendFriendRequest: (username: string) => Promise<void>
  acceptRequest: (id: number) => Promise<void>
  deleteRequest: (id: number) => Promise<void>
  removeFriend: (userId: string) => Promise<void>
  loadHistory: (friendId: string) => Promise<void>
  loadGlobalHistory: () => Promise<void>
  sendMessage: (to: string, content: string, replyToId?: number | null) => void
  sendGlobalMessage: (content: string, replyToId?: number | null) => void
  editMessage: (friendId: string, messageId: number, content: string) => Promise<void>
  deleteMessage: (friendId: string, messageId: number) => Promise<void>
  deleteGlobalMessage: (messageId: number) => Promise<void>
  reactToMessage: (scope: string, messageId: number, emoji: string) => Promise<void>
  markRead: (friendId: string) => void
}

const ModstackContext = createContext<ModstackContextValue>(null as any)
const GLOBAL_CHAT_CACHE_KEY = 'modstack.globalChat.cache'
const GLOBAL_CHAT_CACHE_LIMIT = 200
const PROFILE_SYNC_PREFIX = 'MODSTACK_PROFILE_SYNC:'

interface HarmonyMusicPresence {
  title?: string
  artist?: string
  isPlaying?: boolean
}

function loadGlobalChatCache(): ChatMessage[] {
  try {
    const cached = JSON.parse(localStorage.getItem(GLOBAL_CHAT_CACHE_KEY) || '[]')
    return Array.isArray(cached) ? cached : []
  } catch {
    return []
  }
}

function saveGlobalChatCache(messages: ChatMessage[]) {
  try {
    localStorage.setItem(GLOBAL_CHAT_CACHE_KEY, JSON.stringify(messages.slice(-GLOBAL_CHAT_CACHE_LIMIT)))
  } catch {}
}

function mergeChatMessages(base: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<number, ChatMessage>()
  for (const message of [...base, ...incoming]) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function ModstackProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<ModstackUser | null>(() => getSession()?.user ?? null)
  const [isWaitingLogin, setIsWaitingLogin] = useState(false)
  const [connected, setConnected] = useState(false)
  const [friends, setFriends] = useState<ModstackFriend[]>([])
  const [incoming, setIncoming] = useState<FriendRequest[]>([])
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({})
  const [globalMessages, setGlobalMessages] = useState<ChatMessage[]>(loadGlobalChatCache)
  const [harmonyMusicPresence, setHarmonyMusicPresence] = useState<HarmonyMusicPresence | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityRef = useRef<string | null>(null)
  const accountRef = useRef(account)
  accountRef.current = account

  const { runningInstances } = useLaunch()
  const { instances } = useInstance()
  const musicTracks = useMusic((state) => state.tracks)
  const musicCurrentIndex = useMusic((state) => state.currentIndex)
  const musicActiveTrackIds = useMusic((state) => state.activeTrackIds)
  const musicIsPlaying = useMusic((state) => state.isPlaying)

  const clearSession = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    wsRef.current?.close()
    wsRef.current = null
    setAccount(null)
    setFriends([])
    setIncoming([])
    setOutgoing([])
    setUnread({})
    setMessages({})
    setConnected(false)
  }, [])

  useEffect(() => {
    saveGlobalChatCache(globalMessages)
  }, [globalMessages])

  useEffect(() => {
    const handler = () => clearSession()
    window.addEventListener('modstack:session-expired', handler)
    return () => window.removeEventListener('modstack:session-expired', handler)
  }, [clearSession])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<HarmonyMusicPresence | null>).detail
      if (!detail?.isPlaying || !detail.title?.trim()) {
        setHarmonyMusicPresence(null)
        return
      }
      setHarmonyMusicPresence({
        title: detail.title.trim(),
        artist: detail.artist?.trim() || '',
        isPlaying: true,
      })
    }
    window.addEventListener('harmony:music-presence', handler)
    return () => window.removeEventListener('harmony:music-presence', handler)
  }, [])

  const refreshSocial = useCallback(async () => {
    if (!accountRef.current) return
    try {
      const [f, r, u] = await Promise.all([
        modstack.getFriends(),
        modstack.getRequests(),
        modstack.getUnread(),
      ])
      setFriends(f.friends)
      setIncoming(r.incoming)
      setOutgoing(r.outgoing)
      const counts: Record<string, number> = {}
      for (const row of u.unread) counts[row.userId] = Number(row.count)
      setUnread(counts)
    } catch (e) {
      console.error('[modstack] failed to load social data:', e)
    }
  }, [])

  const updateFriendPresence = useCallback(
    (userId: string, status: PresenceStatus, activity: string | null) => {
      setFriends((prev) =>
        prev.map((f) => (f.id === userId ? { ...f, status, activity } : f)),
      )
    },
    [],
  )

  const publishPresence = useCallback((activity: string | null, force = false) => {
    if (!force && activity === activityRef.current) return
    activityRef.current = activity
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'presence', activity }))
    }
  }, [])

  const handleWsMessage = useCallback(
    (msg: any) => {
      switch (msg.type) {
        case 'ready': {
          const presence = new Map<string, { status: PresenceStatus; activity: string | null }>(
            (msg.presence || []).map((p: any) => [p.userId, { status: p.status, activity: p.activity }]),
          )
          setFriends((prev) =>
            prev.map((f) => {
              const p = presence.get(f.id)
              return p ? { ...f, ...p } : { ...f, status: 'offline', activity: null }
            }),
          )
          break
        }
        case 'presence':
          updateFriendPresence(msg.userId, msg.status, msg.activity)
          break
        case 'chat:message': {
          const m: ChatMessage = msg.message
          const me = accountRef.current
          if (!me) break
          const friendId = m.senderId === me.id ? m.receiverId : m.senderId
          const hiddenProfileSync = typeof m.content === 'string' && m.content.trim().startsWith(PROFILE_SYNC_PREFIX)
          setMessages((prev) => {
            const list = prev[friendId]
            if (!list) return { ...prev, [friendId]: [m] }
            if (list.some((x) => x.id === m.id)) return prev
            return { ...prev, [friendId]: [...list, m] }
          })
          if (m.senderId !== me.id && !hiddenProfileSync) {
            setUnread((prev) => ({ ...prev, [friendId]: (prev[friendId] || 0) + 1 }))
          }
          break
        }
        case 'chat:global': {
          const m: ChatMessage = msg.message
          setGlobalMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
          break
        }
        case 'chat:edited': {
          const m: ChatMessage = msg.message
          const me = accountRef.current
          if (!me) break
          const friendId = m.senderId === me.id ? m.receiverId : m.senderId
          setMessages((prev) => {
            const list = prev[friendId]
            if (!list) return prev
            return { ...prev, [friendId]: list.map((x) => (x.id === m.id ? m : x)) }
          })
          setGlobalMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)))
          break
        }
        case 'chat:deleted': {
          const messageId = Number(msg.messageId)
          setMessages((prev) => {
            const next: Record<string, ChatMessage[]> = {}
            let changed = false
            for (const [key, list] of Object.entries(prev)) {
              const filtered = list.filter((x) => x.id !== messageId)
              next[key] = filtered
              if (filtered.length !== list.length) changed = true
            }
            return changed ? next : prev
          })
          setGlobalMessages((prev) => prev.filter((x) => x.id !== messageId))
          break
        }
        case 'chat:reaction': {
          const messageId = Number(msg.messageId)
          const reactions = msg.reactions
          const patch = (m: ChatMessage) => (m.id === messageId ? { ...m, reactions } : m)
          setMessages((prev) => {
            const next: Record<string, ChatMessage[]> = {}
            for (const [key, list] of Object.entries(prev)) next[key] = list.map(patch)
            return next
          })
          setGlobalMessages((prev) => prev.map(patch))
          break
        }
        case 'friend:request':
          setIncoming((prev) =>
            prev.some((r) => r.id === msg.request.id) ? prev : [msg.request, ...prev],
          )
          break
        case 'friend:accepted': {
          const friend: ModstackUser = msg.friend
          setOutgoing((prev) => prev.filter((r) => r.userId !== friend.id))
          setIncoming((prev) => prev.filter((r) => r.userId !== friend.id))
          setFriends((prev) =>
            prev.some((f) => f.id === friend.id)
              ? prev
              : [...prev, { ...friend, status: 'offline', activity: null }],
          )
          break
        }
        case 'friend:removed':
          setFriends((prev) => prev.filter((f) => f.id !== msg.userId))
          break
      }
    },
    [updateFriendPresence],
  )

  useEffect(() => {
    if (!account) return

    let disposed = false

    const connect = async () => {
      if (disposed) return
      const token = (await getFreshAccessToken()) || getSession()?.accessToken
      if (!token || disposed) return

      const ws = new WebSocket(MODSTACK_WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
      }

      ws.onmessage = (event) => {
        let msg: any
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        if (msg.type === 'ready') {
          setConnected(true)
          publishPresence(activityRef.current, true)
        }
        handleWsMessage(msg)
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        if (!disposed && accountRef.current) {
          reconnectTimer.current = setTimeout(connect, 4000)
        }
      }

      ws.onerror = () => ws.close()
    }

    refreshSocial()
    connect()

    return () => {
      disposed = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [account, handleWsMessage, publishPresence, refreshSocial])

  useEffect(() => {
    let activity: string | null = null
    const runningId = [...runningInstances][0]
    if (runningId) {
      const inst = instances.find((i) => i.id === runningId)
      activity = encodePresenceActivity('playing', inst?.title || 'Minecraft')
    } else if (harmonyMusicPresence?.isPlaying && harmonyMusicPresence.title) {
      activity = encodePresenceActivity(
        'listening',
        [harmonyMusicPresence.title, harmonyMusicPresence.artist].filter(Boolean).join(' - '),
      )
    } else if (musicIsPlaying) {
      const track = getCurrentTrack({
        tracks: musicTracks,
        currentIndex: musicCurrentIndex,
        activeTrackIds: musicActiveTrackIds,
      })
      if (track?.title) {
        activity = encodePresenceActivity(
          'listening',
          [track.title, track.artist].filter(Boolean).join(' - '),
        )
      }
    }
    publishPresence(activity)
  }, [runningInstances, instances, harmonyMusicPresence, musicTracks, musicCurrentIndex, musicActiveTrackIds, musicIsPlaying, publishPresence])

  const login = useCallback(async (provider: 'google' | 'discord') => {
    setIsWaitingLogin(true)
    try {
      const user = await modstack.loginWithProvider(provider)
      setAccount(user)
    } finally {
      setIsWaitingLogin(false)
    }
  }, [])

  const logout = useCallback(() => {
    modstack.logout()
    clearSession()
  }, [clearSession])

  const uploadAvatar = useCallback(async (file: File) => {
    const user = await modstack.uploadAvatar(file)
    setAccount(user)
    return user
  }, [])

  const updateProfile = useCallback(async (profile: { username?: string; bio?: string }) => {
    const user = await modstack.updateProfile(profile)
    setAccount(user)
    return user
  }, [])

  const sendFriendRequest = useCallback(async (username: string) => {
    await modstack.sendRequest(username)
    await refreshSocial()
  }, [refreshSocial])

  const acceptRequest = useCallback(async (id: number) => {
    await modstack.acceptRequest(id)
    setIncoming((prev) => prev.filter((r) => r.id !== id))
    await refreshSocial()
  }, [refreshSocial])

  const deleteRequest = useCallback(async (id: number) => {
    await modstack.deleteRequest(id)
    setIncoming((prev) => prev.filter((r) => r.id !== id))
    setOutgoing((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const removeFriend = useCallback(async (userId: string) => {
    await modstack.removeFriend(userId)
    setFriends((prev) => prev.filter((f) => f.id !== userId))
  }, [])

  const loadHistory = useCallback(async (friendId: string) => {
    const { messages: history } = await modstack.getMessages(friendId)
    setMessages((prev) => ({ ...prev, [friendId]: history }))
  }, [])

  const loadGlobalHistory = useCallback(async () => {
    const cached = loadGlobalChatCache()
    if (cached.length) setGlobalMessages((prev) => mergeChatMessages(prev, cached))
    try {
      const { messages: history } = await modstack.getGlobalMessages()
      setGlobalMessages((prev) => mergeChatMessages(prev, history))
    } catch (e) {
      console.error('[modstack] failed to load global history:', e)
    }
  }, [])

  const sendMessage = useCallback((to: string, content: string, replyToId?: number | null) => {
    const trimmed = content.trim()
    if (!trimmed) return
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat:send', to, content: trimmed, replyToId: replyToId ?? null }))
    } else {
      modstack
        .sendMessageRest(to, trimmed, replyToId)
        .then(({ message }) => {
          setMessages((prev) => {
            const list = prev[to]
            if (!list) return { ...prev, [to]: [message] }
            if (list.some((x) => x.id === message.id)) return prev
            return { ...prev, [to]: [...list, message] }
          })
        })
        .catch((e) => console.error('[modstack] failed to send message:', e))
    }
  }, [])

  const sendGlobalMessage = useCallback((content: string, replyToId?: number | null) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const me = accountRef.current
    const optimistic: ChatMessage | null = me
      ? {
          id: -Date.now(),
          senderId: me.id,
          receiverId: 'global',
          content: trimmed,
          createdAt: new Date().toISOString(),
          editedAt: null,
          readAt: null,
          replyToId: replyToId ?? null,
          sender: me,
        }
      : null
    if (optimistic) setGlobalMessages((prev) => [...prev, optimistic])
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat:global:send', content: trimmed, replyToId: replyToId ?? null }))
    } else {
      modstack
        .sendGlobalMessageRest(trimmed, replyToId)
        .then(({ message }) => {
          setGlobalMessages((prev) => {
            const withoutOptimistic = optimistic ? prev.filter((x) => x.id !== optimistic.id) : prev
            return withoutOptimistic.some((x) => x.id === message.id) ? withoutOptimistic : [...withoutOptimistic, message]
          })
        })
        .catch((e) => console.error('[modstack] failed to send global message:', e))
    }
  }, [])

  const editMessage = useCallback(async (friendId: string, messageId: number, content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const previous = messages[friendId] || []
    setMessages((prev) => ({
      ...prev,
      [friendId]: (prev[friendId] || []).map((m) =>
        m.id === messageId ? { ...m, content: trimmed } : m,
      ),
    }))
    try {
      const { message } = await modstack.editMessage(messageId, trimmed)
      if (message) {
        setMessages((prev) => ({
          ...prev,
          [friendId]: (prev[friendId] || []).map((m) => (m.id === messageId ? message : m)),
        }))
      }
    } catch (e) {
      setMessages((prev) => ({ ...prev, [friendId]: previous }))
      throw e
    }
  }, [messages])

  const publishMessageDelete = useCallback((messageId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat:delete', messageId }))
    }
  }, [])

  const deleteMessage = useCallback(async (friendId: string, messageId: number) => {
    const previous = messages[friendId] || []
    setMessages((prev) => ({
      ...prev,
      [friendId]: (prev[friendId] || []).filter((m) => m.id !== messageId),
    }))
    try {
      publishMessageDelete(messageId)
      await modstack.deleteMessage(messageId)
    } catch (e) {
      setMessages((prev) => ({ ...prev, [friendId]: previous }))
      throw e
    }
  }, [messages, publishMessageDelete])

  const deleteGlobalMessage = useCallback(async (messageId: number) => {
    const previous = globalMessages
    setGlobalMessages((prev) => prev.filter((m) => m.id !== messageId))
    try {
      publishMessageDelete(messageId)
      await modstack.deleteMessage(messageId)
    } catch (e) {
      setGlobalMessages(previous)
      throw e
    }
  }, [globalMessages, publishMessageDelete])

  const reactToMessage = useCallback(async (scope: string, messageId: number, emoji: string) => {
    const updateLocal = (list: ChatMessage[]) => list.map((m) => {
      if (m.id !== messageId) return m
      const reactions = [...(m.reactions || [])]
      const found = reactions.find((r) => r.emoji === emoji)
      if (found) {
        found.count = found.me ? Math.max(0, found.count - 1) : found.count + 1
        found.me = !found.me
      } else {
        reactions.push({ emoji, count: 1, me: true })
      }
      return { ...m, reactions: reactions.filter((r) => r.count > 0) }
    })
    if (scope === 'global') {
      setGlobalMessages(updateLocal)
    } else {
      setMessages((prev) => ({ ...prev, [scope]: updateLocal(prev[scope] || []) }))
    }
    try {
      const res = await modstack.reactToMessage(messageId, emoji)
      if (res.message) {
        if (scope === 'global') setGlobalMessages((prev) => prev.map((m) => (m.id === messageId ? res.message! : m)))
        else setMessages((prev) => ({ ...prev, [scope]: (prev[scope] || []).map((m) => (m.id === messageId ? res.message! : m)) }))
      } else if (res.reactions) {
        const applyReactions = (m: ChatMessage) => (m.id === messageId ? { ...m, reactions: res.reactions } : m)
        if (scope === 'global') setGlobalMessages((prev) => prev.map(applyReactions))
        else setMessages((prev) => ({ ...prev, [scope]: (prev[scope] || []).map(applyReactions) }))
      }
    } catch (e) {
      console.error('[modstack] failed to react:', e)
    }
  }, [])

  const markRead = useCallback((friendId: string) => {
    setUnread((prev) => {
      if (!prev[friendId]) return prev
      const next = { ...prev }
      delete next[friendId]
      return next
    })
    modstack.markRead(friendId).catch(() => {})
  }, [])

  return (
    <ModstackContext.Provider
      value={{
        account,
        isWaitingLogin,
        connected,
        friends,
        incoming,
        outgoing,
        unread,
        messages,
        globalMessages,
        login,
        logout,
        updateProfile,
        uploadAvatar,
        refreshSocial,
        sendFriendRequest,
        acceptRequest,
        deleteRequest,
        removeFriend,
        loadHistory,
        loadGlobalHistory,
        sendMessage,
        sendGlobalMessage,
        editMessage,
        deleteMessage,
        deleteGlobalMessage,
        reactToMessage,
        markRead,
      }}
    >
      {children}
    </ModstackContext.Provider>
  )
}

export function useModstack() {
  const ctx = useContext(ModstackContext)
  if (!ctx) throw new Error('useModstack must be used within ModstackProvider')
  return ctx
}
