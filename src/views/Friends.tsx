import { useEffect, useRef, useState } from 'react'
import { Button, toast } from '@heroui/react'
import {
  IconBrandGoogleFilled,
  IconCheck,
  IconEdit,
  IconMoodSmile,
  IconSend,
  IconUserPlus,
  IconX,
  IconLogout,
  IconUsers,
  IconMessage,
  IconTrash,
  IconArrowLeft,
} from '@tabler/icons-react'
import { useLauncherTranslation } from '../utils/languageContext'
import { useModstack } from '../stores/modstackContext'
import { avatarUrl, type ChatMessage, type ModstackFriend, type FriendRequest } from '../utils/modstack'

const DiscordIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
)

const EMOJIS = ['😀', '😂', '😍', '😎', '😭', '😡', '👍', '🔥', '❤️', '🎮', '✅', '👀']

function Avatar({ avatar, username, size = 40 }: { avatar: string | null; username: string; size?: number }) {
  const url = avatarUrl(avatar)
  if (url) {
    return <img src={url} alt={username} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" />
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full bg-white/10 flex items-center justify-center text-white/70 font-bold shrink-0"
    >
      {username.charAt(0).toUpperCase()}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'playing' ? 'bg-emerald-400' : status === 'online' ? 'bg-sky-400' : 'bg-white/25'
  return <span className={`inline-block size-2.5 rounded-full ${color}`} />
}

function isImageSource(value: string) {
  return /^data:image\//i.test(value) || /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(value)
}

function splitMessageContent(content: string) {
  const parts = content.split(/(\s+)/)
  return parts.map((part, index) => ({ id: `${index}-${part}`, value: part, image: isImageSource(part.trim()) }))
}

function LoginScreen() {
  const { login, isWaitingLogin } = useModstack()
  const t = useLauncherTranslation()

  const doLogin = async (provider: 'google' | 'discord') => {
    try {
      await login(provider)
      toast(t('friends.loggedIn'))
    } catch (e) {
      toast.danger(t('friends.loginFailed'), { description: String((e as Error).message) })
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-0 text-white">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-5">
        <img src="./icon.png" alt="Modstack" width={64} height={64} className="object-contain" />
      </div>
      <h2 className="text-xl font-bold mb-2">{t('friends.accountTitle')}</h2>
      <p className="text-white/60 text-sm max-w-xs text-center mb-7 leading-relaxed">
        {t('friends.loginDescription')}
      </p>
      {isWaitingLogin ? (
        <p className="text-white/70 text-sm animate-pulse">{t('friends.loginWaiting')}</p>
      ) : (
        <div className="flex flex-col gap-2 w-60">
          <Button className="w-full" onPress={() => doLogin('google')}>
            <IconBrandGoogleFilled className="size-4" /> Google
          </Button>
          <div className="flex items-center gap-2.5">
            <div className="flex-1 h-px bg-white/[0.07]" />
            <span className="text-[11px] text-white/20">o</span>
            <div className="flex-1 h-px bg-white/[0.07]" />
          </div>
          <Button className="w-full" onPress={() => doLogin('discord')}>
            <DiscordIcon size={18} /> Discord
          </Button>
        </div>
      )}
    </div>
  )
}

function FriendStatus({ friend }: { friend: ModstackFriend }) {
  const t = useLauncherTranslation()
  if (friend.status === 'playing') return <>{t('friends.playing')} {friend.activity}</>
  if (friend.status === 'online') return <>{t('friends.online')}</>
  return <>{t('friends.offline')}</>
}

function AddFriendsPanel({
  incoming,
  outgoing,
  onAccept,
  onDecline,
  onCancelRequest,
  onSendRequest,
  onBack,
}: {
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  onAccept: (id: number) => void
  onDecline: (id: number) => void
  onCancelRequest: (id: number) => void
  onSendRequest: (name: string) => Promise<void>
  onBack: () => void
}) {
  const t = useLauncherTranslation()
  const [addName, setAddName] = useState('')
  const [sending, setSending] = useState(false)

  const doAdd = async () => {
    const name = addName.trim()
    if (!name) return
    setSending(true)
    try {
      await onSendRequest(name)
      setAddName('')
    } catch {} finally {
      setSending(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 p-4 border-b border-white/10">
        <Button isIconOnly size="sm" variant="tertiary" onPress={onBack} aria-label="Volver">
          <IconArrowLeft className="size-4" />
        </Button>
        <IconUserPlus className="size-4 text-white/60" />
        <h2 className="font-semibold text-white flex-1">{t('friends.addFriend') ?? 'Añadir amigos'}</h2>
      </div>

      <div className="p-4 border-b border-white/10">
        <p className="text-xs text-white/40 mb-2 uppercase">{t('friends.addByUsername')}</p>
        <div className="flex gap-2">
          <input
            autoFocus
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doAdd() }}
            maxLength={16}
            placeholder="Username..."
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30"
          />
          <Button size="sm" isDisabled={sending || !addName.trim()} onPress={doAdd}>
            <IconSend className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {incoming.length > 0 && (
          <div className="p-3 border-b border-white/10">
            <p className="text-xs uppercase text-white/40 mb-2">{t('friends.incomingRequests')}</p>
            {incoming.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5">
                <Avatar avatar={r.avatar} username={r.username} size={30} />
                <span className="flex-1 text-sm truncate">{r.username}</span>
                <Button isIconOnly size="sm" onPress={() => onAccept(r.id)} aria-label={t('friends.accept')}>
                  <IconCheck className="size-4" />
                </Button>
                <Button isIconOnly size="sm" variant="tertiary" onPress={() => onDecline(r.id)} aria-label={t('friends.decline')}>
                  <IconX className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {outgoing.length > 0 && (
          <div className="p-3">
            <p className="text-xs uppercase text-white/40 mb-2">{t('friends.sent')}</p>
            {outgoing.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5">
                <Avatar avatar={r.avatar} username={r.username} size={30} />
                <span className="flex-1 text-sm truncate">{r.username}</span>
                <Button isIconOnly size="sm" variant="tertiary" onPress={() => onCancelRequest(r.id)} aria-label={t('friends.cancel')}>
                  <IconX className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {incoming.length === 0 && outgoing.length === 0 && (
          <p className="text-sm text-white/40 text-center mt-8">{t('friends.noRequests') ?? 'Sin solicitudes pendientes'}</p>
        )}
      </div>
    </div>
  )
}

function FriendsPanel({
  friends,
  onOpenChat,
  onRemoveFriend,
}: {
  friends: ModstackFriend[]
  onOpenChat: (id: string) => void
  onRemoveFriend: (id: string) => void
}) {
  const t = useLauncherTranslation()

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 p-4 border-b border-white/10">
        <IconUsers className="size-4 text-white/60" />
        <h2 className="font-semibold text-white flex-1">{t('friends.friends')} ({friends.length})</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
        {friends.length === 0 && (
          <p className="text-sm text-white/40 text-center mt-8">{t('friends.empty')}</p>
        )}
        {friends.map((f) => (
          <div key={f.id} className="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5" onClick={() => onOpenChat(f.id)}>
            <Avatar avatar={f.avatar} username={f.username} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-1.5">
                <StatusDot status={f.status} /> {f.username}
              </p>
              <p className="text-xs text-white/50 truncate"><FriendStatus friend={f} /></p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              aria-label={t('friends.removeFriend')}
              className="text-danger opacity-0 group-hover:opacity-100 transition-opacity"
              onPress={() => onRemoveFriend(f.id)}
            >
              <IconTrash className="size-4" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              aria-label={t('friends.message')}
              onPress={() => onOpenChat(f.id)}
            >
              <IconMessage className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({
  message, mine, onEdit, onDelete, senderUsername, senderAvatar,
}: {
  message: ChatMessage
  mine: boolean
  onEdit: (newContent: string) => void
  onDelete: () => void
  senderUsername: string
  senderAvatar: string | null
}) {
  const t = useLauncherTranslation()
  const parts = splitMessageContent(message.content)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const startEdit = () => {
    setEditText(message.content)
    setIsEditing(true)
    setTimeout(() => {
      textareaRef.current?.focus()
      const len = textareaRef.current?.value.length ?? 0
      textareaRef.current?.setSelectionRange(len, len)
    }, 0)
  }

  const confirmEdit = () => {
    const value = editText.trim()
    if (value && value !== message.content) onEdit(value)
    setIsEditing(false)
  }

  const cancelEdit = () => {
    setEditText(message.content)
    setIsEditing(false)
  }

return (
    <div className={`group flex max-w-[72%] min-w-0 items-start gap-2 ${mine ? 'self-end flex-row-reverse' : 'self-start'}`}>
      <Avatar avatar={senderAvatar} username={senderUsername} size={32} />

      <div className={`relative flex flex-col min-w-0 ${mine ? 'items-end' : 'items-start'}`}>
        {mine && !isEditing && (
          <div className="absolute right-full top-6 pr-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={startEdit}
              aria-label={t('friends.edit')}
              className="size-6 flex items-center justify-center rounded text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors"
            >
              <IconEdit className="size-3.5" />
            </button>
            <button
              onClick={onDelete}
              aria-label={t('friends.delete')}
              className="size-6 flex items-center justify-center rounded text-white/30 hover:text-danger hover:bg-white/10 transition-colors"
            >
              <IconTrash className="size-3.5" />
            </button>
          </div>
        )}

        <div className={`flex items-baseline gap-1.5 mb-1 ${mine ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-semibold text-white/80">{senderUsername}</span>
          <span className="text-[11px] text-white/35">
            {new Date(message.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {isEditing ? (
          <div className="w-full">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEdit() }
                if (e.key === 'Escape') cancelEdit()
              }}
              maxLength={12000}
              rows={Math.min(editText.split('\n').length + 1, 6)}
              className="resize-none rounded-lg border border-accent/60 bg-white/10 px-3 py-1.5 text-sm text-white outline-none focus:border-accent [overflow-wrap:anywhere] w-full"
            />
            <div className="flex gap-1 justify-end mt-1">
              <Button isIconOnly size="sm" variant="tertiary" aria-label={t('friends.cancel')} onPress={cancelEdit} className="size-6">
                <IconX className="size-3" />
              </Button>
              <Button isIconOnly size="sm" aria-label={t('friends.save')} onPress={confirmEdit} className="size-6">
                <IconCheck className="size-3" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`min-w-0 overflow-hidden rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                mine ? 'bg-accent text-accent-foreground' : 'bg-white/10 text-white'
              }`}
            >
              {parts.map((part) =>
                part.image ? (
                  <img
                    key={part.id}
                    src={part.value.trim()}
                    alt=""
                    className="my-1 max-h-64 w-full max-w-80 rounded-md border border-white/10 object-contain"
                  />
                ) : (
                  <span key={part.id}>{part.value}</span>
                )
              )}
            </div>
            {message.editedAt && (
              <span className="text-[10px] text-white/35 mt-0.5 px-1">{t('friends.edited')}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ChatPanel({ friend, onClose }: { friend: ModstackFriend; onClose: () => void }) {
  const { account, messages, loadHistory, sendMessage, editMessage, deleteMessage, markRead, unread } = useModstack()
  const t = useLauncherTranslation()
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const history = messages[friend.id]

  useEffect(() => {
    if (!history) loadHistory(friend.id).catch(() => {})
  }, [friend.id, history, loadHistory])

  useEffect(() => {
    if (unread[friend.id]) markRead(friend.id)
  }, [friend.id, unread, markRead])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [history?.length])

  useEffect(() => {
    setText('')
    setShowEmoji(false)
  }, [friend.id])

  const submit = async () => {
    const value = text.trim()
    if (!value) return
    try {
      sendMessage(friend.id, value)
      setText('')
    } catch (e) {
      toast.danger(t('friends.sendFailed'), { description: String((e as Error).message) })
    }
  }

  const attachFile = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setText((value) => `${value}${value ? '\n' : ''}${String(reader.result)}`)
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 p-3 border-b border-white/10">
        <Avatar avatar={friend.avatar} username={friend.username} size={32} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white leading-tight">{friend.username}</p>
          <p className="text-xs text-white/50 leading-tight"><FriendStatus friend={friend} /></p>
        </div>
        <Button isIconOnly size="sm" variant="tertiary" aria-label="Volver" onPress={onClose}>
          <IconArrowLeft className="size-4" />
        </Button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {!history && <p className="text-white/40 text-sm">{t('friends.loadingMessages')}</p>}
        {history?.length === 0 && <p className="text-white/40 text-sm">{t('friends.noMessages')}</p>}
        {history?.map((m) => {
          const mine = m.senderId === account?.id
          return (
            <MessageBubble
              key={m.id}
              message={m}
              mine={mine}
              senderUsername={mine ? (account?.username ?? '') : friend.username}
              senderAvatar={mine ? (account?.avatar ?? null) : friend.avatar}
              onEdit={(newContent) => editMessage(friend.id, m.id, newContent).catch((e) => toast.danger(t('friends.sendFailed'), { description: String(e) }))}
              onDelete={() => deleteMessage(friend.id, m.id).catch((e) => toast.danger(t('friends.delete'), { description: String(e) }))}
            />
          )
        })}
      </div>

      <div className="relative border-t border-white/10 p-3">
        {showEmoji && (
          <div className="absolute bottom-full left-3 mb-2 grid grid-cols-6 gap-1 rounded-lg border border-white/10 bg-surface-secondary p-2 shadow-xl">
            {EMOJIS.map((emoji) => (
              <button key={emoji} onClick={() => setText((value) => `${value}${emoji}`)} className="size-8 rounded-md hover:bg-white/10">
                {emoji}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button isIconOnly variant="tertiary" onPress={() => setShowEmoji((v) => !v)} aria-label={t('friends.emoji')}>
            <IconMoodSmile className="size-4" />
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => attachFile(e.target.files?.[0])} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
            maxLength={12000}
            placeholder={`${t('friends.message')} ${friend.username}`}
            className="max-h-10 min-h-3 flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
          />
          <Button isIconOnly onPress={submit} aria-label={t('friends.send')}>
            <IconSend className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function Friends() {
  const {
    account,
    connected,
    friends,
    incoming,
    outgoing,
    unread,
    logout,
    sendFriendRequest,
    acceptRequest,
    deleteRequest,
    removeFriend,
  } = useModstack()
  const t = useLauncherTranslation()
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [openChats, setOpenChats] = useState<string[]>([])
  const [showAddFriends, setShowAddFriends] = useState(false)

  if (!account) return <LoginScreen />

  const activeFriend = friends.find((f) => f.id === activeChat) || null

  const openChat = (id: string) => {
    setActiveChat(id)
    setShowAddFriends(false)
    setOpenChats((prev) => prev.includes(id) ? prev : [...prev, id])
  }

  const closeChat = (id: string) => {
    setOpenChats((prev) => prev.filter((c) => c !== id))
    if (activeChat === id) setActiveChat(null)
  }

  const mainPanel = activeFriend ? (
    <ChatPanel friend={activeFriend} onClose={() => setActiveChat(null)} />
  ) : showAddFriends ? (
    <AddFriendsPanel
      incoming={incoming}
      outgoing={outgoing}
      onAccept={(id) => acceptRequest(id).catch(() => {})}
      onDecline={(id) => deleteRequest(id).catch(() => {})}
      onCancelRequest={(id) => deleteRequest(id).catch(() => {})}
      onSendRequest={async (name) => {
        await sendFriendRequest(name)
        toast(`${t('friends.requestSent')} ${name}`)
      }}
      onBack={() => setShowAddFriends(false)}
    />
  ) : (
    <FriendsPanel
      friends={friends}
      onOpenChat={openChat}
      onRemoveFriend={(id) => { removeFriend(id).catch(() => {}); closeChat(id) }}
    />
  )

  return (
    <div className="flex-1 flex min-h-0 text-white">
      <div className="w-72 shrink-0 border-r border-white/10 flex flex-col min-h-0">
        <div className="p-3 flex items-center gap-3 border-b border-white/10">
          <Avatar avatar={account.avatar} username={account.username} size={36} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{account.username}</p>
            <p className="text-xs text-white/50">{connected ? t('friends.connected') : t('friends.connecting')}</p>
          </div>
          <div className="relative">
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={() => { setShowAddFriends(true); setActiveChat(null) }}
              aria-label={t('friends.addFriend')}
            >
              <IconUserPlus className="size-4" />
            </Button>
            {incoming.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-red-500 border-2 border-surface pointer-events-none" />
            )}
          </div>
          <Button isIconOnly variant="tertiary" size="sm" onPress={logout} aria-label={t('friends.logout')}>
            <IconLogout className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {openChats.length > 0 && (
            <div className="p-3 border-b border-white/10">
              <p className="text-xs uppercase text-white/40 mb-2">{t('friends.directMessages') ?? 'Mensajes directos'}</p>
              {openChats.map((id) => {
                const f = friends.find((fr) => fr.id === id)
                if (!f) return null
                return (
                  <div
                    key={f.id}
                    onClick={() => { setActiveChat(f.id); setShowAddFriends(false) }}
                    className={`group flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-white/5 ${
                      activeChat === f.id ? 'bg-white/10' : ''
                    }`}
                  >
                    <Avatar avatar={f.avatar} username={f.username} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.username}</p>
                      <p className="text-xs text-white/50 truncate"><FriendStatus friend={f} /></p>
                    </div>
                    {unread[f.id] ? (
                      <span className="bg-accent text-accent-foreground text-xs font-bold rounded-full px-1.5 py-0.5 min-w-5 text-center">
                        {unread[f.id]}
                      </span>
                    ) : null}
                    <Button
                      isIconOnly
                      size="sm"
                      variant="tertiary"
                      aria-label={t('friends.closeChat')}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onPress={(e) => {
                        ;(e as unknown as MouseEvent).stopPropagation?.()
                        closeChat(f.id)
                      }}
                    >
                      <IconX className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="p-3">
            <p className="text-xs uppercase text-white/40 mb-2">{t('friends.friends')} ({friends.length})</p>
            {friends.length === 0 && (
              <p className="text-sm text-white/40">{t('friends.empty')}</p>
            )}
            {friends.map((f) => (
              <div
                key={f.id}
                onClick={() => openChat(f.id)}
                className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-white/5"
              >
                <Avatar avatar={f.avatar} username={f.username} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    <StatusDot status={f.status} /> {f.username}
                  </p>
                  <p className="text-xs text-white/50 truncate"><FriendStatus friend={f} /></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {mainPanel}
    </div>
  )
}