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
} from '../utils/modstack'
import { useLaunch } from './launchContext'
import { useInstance } from './instanceContext'

interface ModstackContextValue {
  account: ModstackUser | null
  isWaitingLogin: boolean
  connected: boolean
  friends: ModstackFriend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  unread: Record<string, number>
  messages: Record<string, ChatMessage[]>
  login: (provider: 'google' | 'discord') => Promise<void>
  logout: () => void
  refreshSocial: () => Promise<void>
  sendFriendRequest: (username: string) => Promise<void>
  acceptRequest: (id: number) => Promise<void>
  deleteRequest: (id: number) => Promise<void>
  removeFriend: (userId: string) => Promise<void>
  loadHistory: (friendId: string) => Promise<void>
  sendMessage: (to: string, content: string) => void
  editMessage: (friendId: string, messageId: number, content: string) => Promise<void>
  deleteMessage: (friendId: string, messageId: number) => Promise<void>
  markRead: (friendId: string) => void
}

const ModstackContext = createContext<ModstackContextValue>(null as any)

export function ModstackProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<ModstackUser | null>(() => getSession()?.user ?? null)
  const [isWaitingLogin, setIsWaitingLogin] = useState(false)
  const [connected, setConnected] = useState(false)
  const [friends, setFriends] = useState<ModstackFriend[]>([])
  const [incoming, setIncoming] = useState<FriendRequest[]>([])
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityRef = useRef<string | null>(null)
  const accountRef = useRef(account)
  accountRef.current = account

  const { runningInstances } = useLaunch()
  const { instances } = useInstance()

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
    const handler = () => clearSession()
    window.addEventListener('modstack:session-expired', handler)
    return () => window.removeEventListener('modstack:session-expired', handler)
  }, [clearSession])

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
          setMessages((prev) => {
            const list = prev[friendId]
            if (!list) return prev
            if (list.some((x) => x.id === m.id)) return prev
            return { ...prev, [friendId]: [...list, m] }
          })
          if (m.senderId !== me.id) {
            setUnread((prev) => ({ ...prev, [friendId]: (prev[friendId] || 0) + 1 }))
          }
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
          break
        }
        case 'chat:deleted': {
          const me = accountRef.current
          if (!me) break
          const friendId = msg.senderId === me.id ? msg.receiverId : msg.senderId
          setMessages((prev) => {
            const list = prev[friendId]
            if (!list) return prev
            return { ...prev, [friendId]: list.filter((x) => x.id !== msg.messageId) }
          })
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
          if (activityRef.current) {
            ws.send(JSON.stringify({ type: 'presence', activity: activityRef.current }))
          }
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
  }, [account, handleWsMessage, refreshSocial])

  useEffect(() => {
    let activity: string | null = null
    const runningId = [...runningInstances][0]
    if (runningId) {
      const inst = instances.find((i: any) => i.id === runningId)
      activity = (inst as any)?.title || 'Minecraft'
    }
    if (activity === activityRef.current) return
    activityRef.current = activity
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'presence', activity }))
    }
  }, [runningInstances, instances])

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

  const sendMessage = useCallback((to: string, content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat:send', to, content: trimmed }))
    } else {
      modstack
        .sendMessageRest(to, trimmed)
        .then(({ message }) => {
          setMessages((prev) => {
            const list = prev[to]
            if (!list || list.some((x) => x.id === message.id)) return prev
            return { ...prev, [to]: [...list, message] }
          })
        })
        .catch((e) => console.error('[modstack] failed to send message:', e))
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

  const deleteMessage = useCallback(async (friendId: string, messageId: number) => {
    const previous = messages[friendId] || []
    setMessages((prev) => ({
      ...prev,
      [friendId]: (prev[friendId] || []).filter((m) => m.id !== messageId),
    }))
    try {
      await modstack.deleteMessage(messageId)
    } catch (e) {
      setMessages((prev) => ({ ...prev, [friendId]: previous }))
      throw e
    }
  }, [messages])

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
        login,
        logout,
        refreshSocial,
        sendFriendRequest,
        acceptRequest,
        deleteRequest,
        removeFriend,
        loadHistory,
        sendMessage,
        editMessage,
        deleteMessage,
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