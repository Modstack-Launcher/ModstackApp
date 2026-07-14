import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  IconCornerUpLeft,
  IconWorld,
  IconKey,
  IconPlus,
  IconMusic,
  IconPlaylist,
  IconUserMinus,
} from '@tabler/icons-react'
import { useLauncherTranslation } from '../utils/languageContext'
import { useModstack } from '../stores/modstackContext'
import { useFriendsPanel } from '../utils/friendsPanelStore'
import { avatarUrl, parsePresence, type ChatMessage, type ModstackFriend, type FriendRequest } from '../utils/modstack'
import { cleanInstanceShareMessage, importSharedInstance, parseInstanceShareMessage } from '../utils/instanceShare'
import {
  cleanMusicPlaylistShareMessage,
  createMusicPlaylistShareMessage,
  createMusicPlaylistSharePayload,
  parseMusicPlaylistShareMessage,
  sharedTrackToMusicTrack,
  type MusicPlaylistSharePayload,
} from '../utils/musicShare'
import { useMusic, type MusicTrack } from '../utils/musicContext'
import { searchYouTubeMusic, toTrack } from '../utils/musicProviders'

const DiscordIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
)

const EMOJIS = ['😀', '😂', '😍', '😎', '😭', '😡', '👍', '🔥', '❤️', '🎮', '✅', '👀']
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👀']

const GROUPS_KEY = 'modstack.chat.groups'
const GROUP_MESSAGES_KEY = 'modstack.chat.groupMessages'
const GROUP_MEMBER_LIMIT = 10

interface LocalChatGroup {
  id: string
  name: string
  createdAt: string
  memberIds: string[]
}

function loadLocalGroups(): LocalChatGroup[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.map((group) => ({
          id: String(group.id),
          name: String(group.name),
          createdAt: group.createdAt || new Date().toISOString(),
          memberIds: Array.isArray(group.memberIds) ? group.memberIds.map(String) : [],
        }))
      : []
  } catch {
    return []
  }
}

function saveLocalGroups(groups: LocalChatGroup[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups))
}

function loadGroupMessages(): Record<string, ChatMessage[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(GROUP_MESSAGES_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveGroupMessages(messages: Record<string, ChatMessage[]>) {
  localStorage.setItem(GROUP_MESSAGES_KEY, JSON.stringify(messages))
}

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
    <div className="flex-1 flex flex-col items-center justify-center gap-0 text-white p-6">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-5">
        <img src="./icon.png" alt="Modstack" width={64} height={64} className="object-contain" />
      </div>
      <h2 className="text-xl font-bold mb-2 text-center">{t('friends.accountTitle')}</h2>
      <p className="text-white/60 text-sm max-w-xs text-center mb-7 leading-relaxed">
        {t('friends.loginDescription')}
      </p>
      {isWaitingLogin ? (
        <p className="text-white/70 text-sm animate-pulse">{t('friends.loginWaiting')}</p>
      ) : (
        <div className="flex flex-col gap-2 w-full max-w-60">
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
          <div key={f.id} className="group flex items-center gap-3 p-2.5 rounded-lg transition-all duration-200 hover:bg-white/5 hover:scale-[1.01]" onClick={() => onOpenChat(f.id)}>
            <Avatar avatar={f.avatar} username={f.username} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-1.5">
                <StatusDot friend={f} /> {f.username}
              </p>
              <p className="text-xs text-white/50 truncate"><FriendStatus friend={f} /></p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              aria-label={t('friends.removeFriend')}
              className="text-danger"
              onPress={(e) => {
                ;(e as unknown as MouseEvent).stopPropagation?.()
                onRemoveFriend(f.id)
              }}
            >
              <IconTrash className="size-4" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              aria-label={t('friends.message')}
              onPress={(e) => {
                ;(e as unknown as MouseEvent).stopPropagation?.()
                onOpenChat(f.id)
              }}
            >
              <IconMessage className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusDot({ friend }: { friend: ModstackFriend }) {
  const presence = parsePresence(friend.status, friend.activity)
  const color =
    presence.kind === 'playing' || presence.kind === 'listening'
      ? 'bg-emerald-400'
      : presence.kind === 'online'
        ? 'bg-accent'
        : 'bg-white/25'
  return <span className={`inline-block size-2.5 rounded-full ${color}`} />
}

function FriendStatus({ friend }: { friend: ModstackFriend }) {
  const t = useLauncherTranslation()
  const presence = parsePresence(friend.status, friend.activity)
  if (presence.kind === 'playing') return <>{t('friends.playing')}: {presence.text ?? 'Minecraft'}</>
  if (presence.kind === 'listening') return <>{t('friends.listening')}: {presence.text}</>
  if (presence.kind === 'online') return <>{t('friends.online')}</>
  return <>{t('friends.offline')}</>
}

function cleanShareMessageContent(content: string) {
  return cleanMusicPlaylistShareMessage(cleanInstanceShareMessage(content)).trim()
}

function PlaylistShareCard({ payload, mine }: { payload: MusicPlaylistSharePayload; mine: boolean }) {
  const t = useLauncherTranslation()
  const addTracks = useMusic((state) => state.addTracks)
  const createPlaylist = useMusic((state) => state.createPlaylist)
  const updatePlaylist = useMusic((state) => state.updatePlaylist)
  const [importing, setImporting] = useState(false)

  const importPlaylist = async () => {
    if (importing) return
    setImporting(true)
    try {
      const importedTracks: MusicTrack[] = []
      for (const [index, sharedTrack] of payload.tracks.entries()) {
        if (sharedTrack.videoId || sharedTrack.url) {
          importedTracks.push(sharedTrackToMusicTrack(sharedTrack, index))
          continue
        }
        const match = (await searchYouTubeMusic(`${sharedTrack.title} ${sharedTrack.artist}`))[0]
        if (match) importedTracks.push(toTrack(match))
      }
      if (importedTracks.length === 0) throw new Error(t('music.noResults'))
      addTracks(importedTracks)
      const playlist = createPlaylist(payload.name, importedTracks.map((track) => track.id))
      if (payload.description || payload.logoUrl) {
        updatePlaylist(playlist.id, {
          description: payload.description,
          logoUrl: payload.logoUrl,
        })
      }
      toast(t('music.playlistImported'), { description: `${importedTracks.length} ${t('music.songsAdded')}` })
    } catch (error) {
      toast.danger(t('music.importFailed'), { description: String((error as Error).message) })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      className={[
        'w-64 rounded-[7px] border border-white/10 px-3 py-3 text-white shadow-[0_10px_30px_-18px_rgba(0,0,0,0.75)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.9)]',
        mine ? 'bg-[#6f58d9]' : 'bg-[#5d50bd]',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-[5px] bg-black/18 flex items-center justify-center">
          {payload.logoUrl ? (
            <img src={payload.logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <IconMusic className="size-6 opacity-80" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{payload.name}</p>
          <p className="truncate text-sm opacity-75">
            {payload.tracks.length} {t('music.songs')}
          </p>
        </div>
      </div>
      <p className="mt-3 truncate text-sm font-medium text-white/85">
        Te comparto mi playlist: {payload.name}
      </p>
      {payload.description && <p className="mt-0.5 truncate text-xs text-white/65">{payload.description}</p>}
      <button
        type="button"
        onClick={importPlaylist}
        disabled={importing}
        className={[
          'mt-3 flex w-full items-center justify-center gap-2 rounded-[5px] bg-white/[0.12] px-3 py-2 text-sm font-bold text-white transition-all duration-200 hover:bg-white/[0.18]',
          importing ? 'opacity-60' : 'hover:scale-[1.01]',
        ].join(' ')}
      >
        <IconMusic className="size-4" />
        {importing ? t('music.importing') : t('music.importPlaylist')}
      </button>
    </div>
  )
}

function GroupsPanel({
  groups,
  friends,
  onOpenGroup,
  onCreateGroup,
  onBack,
}: {
  groups: LocalChatGroup[]
  friends: ModstackFriend[]
  onOpenGroup: (id: string) => void
  onCreateGroup: (name: string, memberIds: string[]) => void
  onBack: () => void
}) {
  const t = useLauncherTranslation()
  const [name, setName] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const totalMembers = selectedIds.length + 1
  const toggleFriend = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id)
      if (prev.length >= GROUP_MEMBER_LIMIT - 1) {
        toast.danger(t('friends.groupLimit') ?? 'Groups can have up to 10 users.')
        return prev
      }
      return [...prev, id]
    })
  }
  const create = () => {
    onCreateGroup(name, selectedIds)
    setName('')
    setSelectedIds([])
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 p-4 border-b border-white/10">
        <Button isIconOnly size="sm" variant="tertiary" onPress={onBack} aria-label="Volver">
          <IconArrowLeft className="size-4" />
        </Button>
        <IconUsers className="size-4 text-white/60" />
        <h2 className="font-semibold text-white flex-1">{t('friends.groups')}</h2>
      </div>

      <div className="p-3 border-b border-white/10 flex flex-col gap-2">
        <p className="text-xs uppercase text-white/40">{t('friends.createGroup')}</p>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('friends.groupName')} className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30" />
          <Button size="sm" isDisabled={!name.trim()} onPress={create}>
            <IconPlus className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs uppercase text-white/40">{t('friends.inviteFriends') ?? 'Invite friends'}</p>
          <span className="text-xs text-white/40">{totalMembers}/{GROUP_MEMBER_LIMIT}</span>
        </div>
        <div className="max-h-36 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03]">
          {friends.length === 0 && <p className="text-xs text-white/40 p-3">{t('friends.empty')}</p>}
          {friends.map((friend) => {
            const selected = selectedIds.includes(friend.id)
            return (
              <button
                key={friend.id}
                type="button"
                onClick={() => toggleFriend(friend.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-white/5"
              >
                <Avatar avatar={friend.avatar} username={friend.username} size={26} />
                <span className="flex-1 min-w-0 text-sm truncate">{friend.username}</span>
                <span className={[
                  'size-4 rounded border flex items-center justify-center',
                  selected ? 'bg-accent border-accent text-black' : 'border-white/20 text-transparent',
                ].join(' ')}>
                  <IconCheck className="size-3" />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
        {groups.length === 0 && <p className="text-sm text-white/40 text-center mt-8">{t('friends.noGroups')}</p>}
        {groups.map((group) => (
          <div key={group.id} className="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5">
            <button className="flex flex-1 min-w-0 items-center gap-3 text-left" onClick={() => onOpenGroup(group.id)}>
              <div className="size-9 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                <IconUsers className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{group.name}</p>
                <p className="text-xs text-white/45 truncate">{(group.memberIds.length + 1)}/{GROUP_MEMBER_LIMIT} {t('friends.members') ?? 'members'}</p>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function LocalGroupChatPanel({
  group,
  friends,
  messages,
  account,
  onClose,
  onSend,
  onInviteFriend,
  onLeaveGroup,
  onEditMessage,
  onDeleteMessage,
}: {
  group: LocalChatGroup
  friends: ModstackFriend[]
  messages: ChatMessage[]
  account: { id: string; username: string; avatar: string | null } | null
  onClose: () => void
  onSend: (content: string) => void
  onInviteFriend: (groupId: string, friendId: string) => void
  onLeaveGroup: (groupId: string) => void
  onEditMessage: (groupId: string, messageId: number, content: string) => void
  onDeleteMessage: (groupId: string, messageId: number) => void
}) {
  const t = useLauncherTranslation()
  const [text, setText] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const invitedFriends = friends.filter((friend) => group.memberIds.includes(friend.id))
  const inviteableFriends = friends.filter((friend) => !group.memberIds.includes(friend.id))
  const memberCount = group.memberIds.length + 1

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length])

  const submit = () => {
    const value = text.trim()
    if (!value) return
    onSend(value)
    setText('')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="flex items-center gap-3 p-3 border-b border-white/10">
        <Button isIconOnly size="sm" variant="tertiary" aria-label="Volver" onPress={onClose}>
          <IconArrowLeft className="size-4" />
        </Button>
        <div className="size-8 rounded-full bg-accent/15 text-accent flex items-center justify-center">
          <IconUsers className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white leading-tight truncate">{group.name}</p>
          <p className="text-xs text-white/50 leading-tight truncate">{memberCount}/{GROUP_MEMBER_LIMIT} {t('friends.members') ?? 'members'}</p>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          aria-label={t('friends.inviteFriends') ?? 'Invite friends'}
          isDisabled={memberCount >= GROUP_MEMBER_LIMIT || inviteableFriends.length === 0}
          onPress={() => setShowInvite((value) => !value)}
        >
          <IconUserPlus className="size-4" />
        </Button>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('friends.leaveGroup') ?? 'Leave group'} onPress={() => onLeaveGroup(group.id)}>
          <IconUserMinus className="size-4" />
        </Button>
      </div>
      {showInvite && (
        <div className="border-b border-white/10 p-2 bg-white/[0.02]">
          <p className="px-1 pb-1.5 text-xs uppercase text-white/40">{t('friends.inviteFriends') ?? 'Invite friends'}</p>
          <div className="max-h-32 overflow-y-auto flex flex-col gap-1">
            {inviteableFriends.length === 0 && <p className="text-xs text-white/40 px-1 py-2">{t('friends.groupFull') ?? 'No more friends can be invited.'}</p>}
            {inviteableFriends.map((friend) => (
              <button
                key={friend.id}
                type="button"
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left"
                onClick={() => {
                  onInviteFriend(group.id, friend.id)
                  if (memberCount + 1 >= GROUP_MEMBER_LIMIT) setShowInvite(false)
                }}
              >
                <Avatar avatar={friend.avatar} username={friend.username} size={24} />
                <span className="flex-1 min-w-0 text-sm truncate">{friend.username}</span>
                <IconPlus className="size-3.5 text-white/50" />
              </button>
            ))}
          </div>
        </div>
      )}
      {invitedFriends.length > 0 && (
        <div className="border-b border-white/10 px-3 py-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[11px] text-white/40 mr-1">{t('friends.members') ?? 'Members'}</span>
          {invitedFriends.map((friend) => (
            <span key={friend.id} className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2 py-1 text-xs text-white/70">
              <Avatar avatar={friend.avatar} username={friend.username} size={16} />
              {friend.username}
            </span>
          ))}
        </div>
      )}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {messages.length === 0 && <p className="text-white/40 text-sm">{t('friends.noMessages')}</p>}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.senderId === account?.id}
            senderUsername={m.sender?.username ?? account?.username ?? 'User'}
            senderAvatar={m.sender?.avatar ?? null}
            onReply={() => {}}
            onReact={() => {}}
            onEdit={(content) => onEditMessage(group.id, m.id, content)}
            onDelete={() => onDeleteMessage(group.id, m.id)}
          />
        ))}
      </div>
      <div className="border-t border-white/10 p-3 flex gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} rows={1} placeholder={`${t('friends.message')} ${group.name}`} className="resize-none flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/30" />
        <Button isIconOnly onPress={submit} aria-label={t('friends.send')}>
          <IconSend className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function MessageBubble({
  message, mine, onEdit, onDelete, onReply, onReact, senderUsername, senderAvatar, canManage = true,
}: {
  message: ChatMessage
  mine: boolean
  onEdit: (newContent: string) => void
  onDelete: () => void
  onReply: () => void
  onReact: (emoji: string) => void
  senderUsername: string
  senderAvatar: string | null
  canManage?: boolean
}) {
  const t = useLauncherTranslation()
  const instanceShare = parseInstanceShareMessage(message.content)
  const musicShare = parseMusicPlaylistShareMessage(message.content)
  const parts = splitMessageContent(message.content)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(message.content)
  const [showReactions, setShowReactions] = useState(false)
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
    <div className={`group flex max-w-[85%] min-w-0 items-start gap-2 ${mine ? 'self-end flex-row-reverse' : 'self-start'}`}>
      <Avatar avatar={senderAvatar} username={senderUsername} size={28} />

      <div className={`relative flex flex-col min-w-0 ${mine ? 'items-end' : 'items-start'}`}>
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
            {message.replyTo && (
              <button
                onClick={onReply}
                className={`mb-1 max-w-full rounded-md border-l-2 px-2 py-1 text-left text-[11px] text-white/55 bg-white/[0.04] border-white/20 ${mine ? 'self-end' : 'self-start'}`}
              >
                <span className="block font-semibold text-white/70 truncate">
                  {message.replyTo.sender?.username || 'Mensaje'}
                </span>
                <span className="block truncate">{message.replyTo.content}</span>
              </button>
            )}
            <div className={`relative max-w-full ${mine ? 'self-end' : 'self-start'}`}>
              {!isEditing && (
                <div className={`absolute -top-7 z-10 flex gap-0.5 rounded-md border border-border bg-surface p-0.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 ${mine ? 'right-0' : 'left-0'}`}>
                  <button
                    onClick={onReply}
                    aria-label="Responder"
                    className="size-6 flex items-center justify-center rounded text-white/35 hover:text-white/75 hover:bg-white/10 transition-colors"
                  >
                    <IconCornerUpLeft className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setShowReactions((value) => !value)}
                    aria-label="Reaccionar"
                    className="size-6 flex items-center justify-center rounded text-white/35 hover:text-white/75 hover:bg-white/10 transition-colors"
                  >
                    <IconMoodSmile className="size-3.5" />
                  </button>
                  {mine && canManage && (
                    <button
                      onClick={startEdit}
                      aria-label={t('friends.edit')}
                      className="size-6 flex items-center justify-center rounded text-white/35 hover:text-white/75 hover:bg-white/10 transition-colors"
                    >
                      <IconEdit className="size-3.5" />
                    </button>
                  )}
                  {mine && canManage && (
                    <button
                      onClick={onDelete}
                      aria-label={t('friends.delete')}
                      className="size-6 flex items-center justify-center rounded text-white/35 hover:text-danger hover:bg-white/10 transition-colors"
                    >
                      <IconTrash className="size-3.5" />
                    </button>
                  )}
                </div>
              )}
              {showReactions && (
                <div className={`absolute z-20 flex gap-1 rounded-full border border-border bg-surface p-1 shadow-xl ${mine ? 'right-0 top-full mt-1' : 'left-0 top-full mt-1'}`}>
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onReact(emoji)
                        setShowReactions(false)
                      }}
                      className="size-7 rounded-full text-[13px] hover:bg-white/10"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {musicShare ? (
                <div className="min-w-0 overflow-visible rounded-xl text-sm transition-all duration-200">
                  <PlaylistShareCard payload={musicShare.payload} mine={mine} />
                  {cleanShareMessageContent(message.content) && (
                    <p className="mt-2 whitespace-pre-wrap break-words">{cleanShareMessageContent(message.content)}</p>
                  )}
                </div>
              ) : instanceShare ? (
                <div className={`min-w-0 overflow-hidden rounded-xl px-3 py-2 text-sm ${mine ? 'bg-accent text-accent-foreground' : 'bg-white/10 text-white'}`}>
                  <div className="rounded-lg bg-black/20 p-2">
                    <div className="flex items-center gap-2">
                      <IconKey className="size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{instanceShare.payload.title}</p>
                        <p className="truncate text-xs opacity-60">{instanceShare.payload.minecraft_version} · {instanceShare.payload.loader}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        importSharedInstance(instanceShare.payload)
                          .then((inst) => {
                            window.dispatchEvent(new CustomEvent('modstack-shared-instance-imported', { detail: inst }))
                            toast(`${instanceShare.payload.title} ${t('inst.importedSuccess')}`)
                          })
                          .catch((error) => toast.danger(t('inst.importError'), { description: String(error) }))
                      }}
                      className="mt-2 w-full rounded-md bg-white/15 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/25"
                    >
                      {t('inst.importInstance')}
                    </button>
                  </div>
                  {cleanShareMessageContent(message.content) && (
                    <p className="mt-2 whitespace-pre-wrap break-words">{cleanShareMessageContent(message.content)}</p>
                  )}
                </div>
              ) : (
                <div
                  className={`min-w-0 overflow-hidden rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-all [overflow-wrap:anywhere] ${
                    mine ? 'bg-accent text-accent-foreground' : 'bg-white/10 text-white'
                  }`}
                >
                  {parts.map((part) =>
                    part.image ? (
                      <img
                        key={part.id}
                        src={part.value.trim()}
                        alt=""
                        className="my-1 max-h-56 w-full max-w-full rounded-md border border-white/10 object-contain"
                      />
                    ) : (
                      <span key={part.id}>{part.value}</span>
                    )
                  )}
                </div>
              )}
            </div>
            {message.editedAt && (
              <span className="text-[10px] text-white/35 mt-0.5 px-1">{t('friends.edited')}</span>
            )}
            <div className={`mt-1 flex max-w-full flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
              {(message.reactions || []).map((reaction) => (
                <button
                  key={reaction.emoji}
                  onClick={() => onReact(reaction.emoji)}
                  className={`h-6 rounded-full border px-2 text-[11px] transition-colors ${
                    reaction.me ? 'border-accent/60 bg-accent/20 text-white' : 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10'
                  }`}
                >
                  {reaction.emoji} {reaction.count}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ChatPanel({ friend, onClose, global = false }: { friend?: ModstackFriend | null; onClose: () => void; global?: boolean }) {
  const {
    account,
    messages,
    globalMessages,
    loadHistory,
    loadGlobalHistory,
    sendMessage,
    sendGlobalMessage,
    editMessage,
    deleteMessage,
    deleteGlobalMessage,
    reactToMessage,
    markRead,
    unread,
  } = useModstack()
  const t = useLauncherTranslation()
  const musicTracks = useMusic((state) => state.tracks)
  const musicPlaylists = useMusic((state) => state.playlists)
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showPlaylistShare, setShowPlaylistShare] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const history = global ? globalMessages : friend ? messages[friend.id] : []
  const musicTracksById = useMemo(() => new Map(musicTracks.map((track) => [track.id, track])), [musicTracks])
  const shareablePlaylists = useMemo(
    () =>
      musicPlaylists
        .map((playlist) => ({
          playlist,
          tracks: playlist.trackIds
            .map((id) => musicTracksById.get(id))
            .filter((track): track is MusicTrack => Boolean(track)),
        }))
        .filter((item) => item.tracks.length > 0),
    [musicPlaylists, musicTracksById],
  )

  useEffect(() => {
    if (global) {
      loadGlobalHistory().catch(() => {})
    } else if (friend && !history) {
      loadHistory(friend.id).catch(() => {})
    }
  }, [friend?.id, global])

  useEffect(() => {
    if (!friend || global) return
    if (unread[friend.id]) markRead(friend.id)
  }, [friend?.id, global, unread, markRead])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [history?.length])

  useEffect(() => {
    setText('')
    setShowEmoji(false)
    setShowPlaylistShare(false)
    setReplyTo(null)
  }, [friend?.id, global])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [text])


  const submit = async () => {
    const value = text.trim()
    if (!value) return
    if (value.length > 800) return 
    try {
      if (global) sendGlobalMessage(value, replyTo?.id)
      else if (friend) sendMessage(friend.id, value, replyTo?.id)
      setText('')
      setReplyTo(null)
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

  const sharePlaylist = (playlistId: string) => {
    const item = shareablePlaylists.find((entry) => entry.playlist.id === playlistId)
    if (!item) return
    const payload = createMusicPlaylistSharePayload(item.playlist, item.tracks)
    const message = createMusicPlaylistShareMessage(payload)
    if (global) sendGlobalMessage(message, replyTo?.id)
    else if (friend) sendMessage(friend.id, message, replyTo?.id)
    setShowPlaylistShare(false)
    setReplyTo(null)
    toast(t('music.playlistShared'), { description: item.playlist.name })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="flex items-center gap-3 p-3 border-b border-white/10">
        <Button isIconOnly size="sm" variant="tertiary" aria-label="Volver" onPress={onClose}>
          <IconArrowLeft className="size-4" />
        </Button>
        {global ? (
          <div className="size-8 rounded-full bg-white/10 flex items-center justify-center text-white/70">
            <IconWorld className="size-4" />
          </div>
        ) : (
          <Avatar avatar={friend?.avatar ?? null} username={friend?.username ?? ''} size={32} />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white leading-tight truncate">{global ? 'Modstack Chat' : friend?.username}</p>
          <p className="text-xs text-white/50 leading-tight truncate">
            {global ? (
              t('friends.descGlobal')
            ) : friend ? (
              <FriendStatus friend={friend} />
            ) : null}
          </p>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {!history && <p className="text-white/40 text-sm">{t('friends.loadingMessages')}</p>}
        {history?.length === 0 && <p className="text-white/40 text-sm">{t('friends.noMessages')}</p>}
        {history?.map((m) => {
          const mine = m.senderId === account?.id
          const directSender = mine ? account : friend
          const sender = global ? (mine ? account : m.sender) : directSender
          return (
            <MessageBubble
              key={m.id}
              message={m}
              mine={mine}
              senderUsername={sender?.username ?? 'Usuario'}
              senderAvatar={sender?.avatar ?? null}
              onReply={() => setReplyTo(m)}
              onReact={(emoji) => reactToMessage(global ? 'global' : (friend?.id ?? ''), m.id, emoji)}
              onEdit={(newContent) => {
                if (!global && friend) editMessage(friend.id, m.id, newContent).catch((e) => toast.danger(t('friends.sendFailed'), { description: String(e) }))
              }}
              onDelete={() => {
                if (global) deleteGlobalMessage(m.id).catch((e) => toast.danger(t('friends.delete'), { description: String(e) }))
                else if (friend) deleteMessage(friend.id, m.id).catch((e) => toast.danger(t('friends.delete'), { description: String(e) }))
              }}
              canManage={!global}
            />
          )
        })}
      </div>

      <div className="relative z-30 border-t border-white/10 p-3 overflow-visible">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
            <IconCornerUpLeft className="size-4 text-white/45" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-white/65">Respondiendo</p>
              <p className="truncate text-xs text-white/45">{replyTo.content}</p>
            </div>
            <Button isIconOnly size="sm" variant="tertiary" onPress={() => setReplyTo(null)} aria-label={t('friends.cancel')}>
              <IconX className="size-3.5" />
            </Button>
          </div>
        )}
        {text.length > 600 && ( 
          <p className={`text-[11px] mb-1 text-right ${text.length >= 800 ? 'text-red-400' : 'text-white/40'}`}>
            {text.length}/800
          </p>
        )}
        {showEmoji && (
          <div className="absolute bottom-[calc(100%+8px)] left-3 z-50 grid grid-cols-6 gap-1 rounded-lg border border-white/10 bg-surface-secondary p-2 shadow-xl">
            {EMOJIS.map((emoji) => (
              <button key={emoji} onClick={() => setText((value) => `${value}${emoji}`)} className="size-8 rounded-md hover:bg-white/10">
                {emoji}
              </button>
            ))}
          </div>
        )}
        {showPlaylistShare && (
          <div className="absolute bottom-[calc(100%+8px)] left-12 z-50 max-h-64 w-72 overflow-y-auto rounded-xl border border-white/10 bg-surface-secondary p-2 shadow-xl animate-in">
            <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">{t('music.playlists')}</p>
            {shareablePlaylists.length === 0 ? (
              <p className="px-2 py-3 text-xs text-white/45">{t('music.noPlaylists')}</p>
            ) : (
              shareablePlaylists.map(({ playlist, tracks }) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => sharePlaylist(playlist.id)}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-all duration-200 hover:bg-white/[0.07] hover:scale-[1.01]"
                >
                  <div className="size-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/10 flex items-center justify-center">
                    {playlist.logoUrl ? (
                      <img src={playlist.logoUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <IconPlaylist className="size-4 text-white/55" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{playlist.name}</p>
                    <p className="truncate text-xs text-white/45">{tracks.length} {t('music.songs')}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
        <div className="flex items-end gap-2 min-w-0 w-full">
          <Button
            isIconOnly
            variant="tertiary"
            onPress={() => {
              setShowPlaylistShare(false)
              setShowEmoji((v) => !v)
            }}
            aria-label={t('friends.emoji')}
          >
            <IconMoodSmile className="size-4" />
          </Button>
          <Button
            isIconOnly
            variant="tertiary"
            onPress={() => {
              setShowEmoji(false)
              setShowPlaylistShare((value) => !value)
            }}
            aria-label={t('music.sharePlaylist')}
          >
            <IconMusic className="size-4" />
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => attachFile(e.target.files?.[0])} />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
            maxLength={1200}
            rows={1}
            placeholder={`${t('friends.message')} ${global ? 'chat global' : friend?.username ?? ''}`}
            className="resize-none scrollbar-hide rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            style={{ 
              maxHeight: 128, 
              minHeight: 38,
              width: 0,     
              flex: '1 1 0',
            }}
          />
          <Button isIconOnly onPress={submit} aria-label={t('friends.send')}>
            <IconSend className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

const PANEL_WIDTH = 340

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
  const { isOpen, close } = useFriendsPanel()
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [openChats, setOpenChats] = useState<string[]>([])
  const [showAddFriends, setShowAddFriends] = useState(false)
  const [showGlobalChat, setShowGlobalChat] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groups, setGroups] = useState<LocalChatGroup[]>(loadLocalGroups)
  const [groupMessages, setGroupMessages] = useState<Record<string, ChatMessage[]>>(loadGroupMessages)

  const activeFriend = friends.find((f) => f.id === activeChat) || null
  const activeGroup = groups.find((group) => group.id === activeGroupId) || null

  useEffect(() => saveLocalGroups(groups), [groups])
  useEffect(() => saveGroupMessages(groupMessages), [groupMessages])

  const openChat = useCallback((id: string) => {
    setActiveChat(id)
    setShowAddFriends(false)
    setShowGlobalChat(false)
    setShowGroups(false)
    setActiveGroupId(null)
    setOpenChats((prev) => prev.includes(id) ? prev : [...prev, id])
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id
      if (id) openChat(id)
    }
    window.addEventListener('open-friend-chat', handler)
    return () => window.removeEventListener('open-friend-chat', handler)
  }, [openChat])

  const openGlobalChat = () => {
    setActiveChat(null)
    setShowAddFriends(false)
    setShowGroups(false)
    setActiveGroupId(null)
    setShowGlobalChat(true)
  }

  const openGroups = () => {
    setActiveChat(null)
    setShowAddFriends(false)
    setShowGlobalChat(false)
    setActiveGroupId(null)
    setShowGroups(true)
  }

  const createGroup = (name: string, memberIds: string[]) => {
    const id = `group-${Date.now()}`
    const group: LocalChatGroup = {
      id,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      memberIds: memberIds.slice(0, GROUP_MEMBER_LIMIT - 1),
    }
    setGroups((prev) => [group, ...prev])
    setActiveGroupId(id)
    setShowGroups(false)
  }

  const inviteFriendToGroup = (groupId: string, friendId: string) => {
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId || group.memberIds.includes(friendId)) return group
      if (group.memberIds.length + 1 >= GROUP_MEMBER_LIMIT) {
        toast.danger(t('friends.groupLimit') ?? 'Groups can have up to 10 users.')
        return group
      }
      return { ...group, memberIds: [...group.memberIds, friendId] }
    }))
  }

  const leaveGroup = (groupId: string) => {
    setGroups((prev) => prev.filter((group) => group.id !== groupId))
    setActiveGroupId(null)
  }

  const sendGroupMessage = (groupId: string, content: string) => {
    if (!account) return
    const message: ChatMessage = {
      id: -Date.now(),
      senderId: account.id,
      receiverId: groupId,
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
      readAt: null,
      sender: account,
    }
    setGroupMessages((prev) => ({ ...prev, [groupId]: [...(prev[groupId] || []), message] }))
  }

  const editGroupMessage = (groupId: string, messageId: number, content: string) => {
    setGroupMessages((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] || []).map((message) =>
        message.id === messageId
          ? { ...message, content, editedAt: new Date().toISOString() }
          : message,
      ),
    }))
  }

  const deleteGroupMessage = (groupId: string, messageId: number) => {
    setGroupMessages((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] || []).filter((message) => message.id !== messageId),
    }))
  }

  const closeChat = (id: string) => {
    setOpenChats((prev) => prev.filter((c) => c !== id))
    if (activeChat === id) setActiveChat(null)
  }

  let content: ReactNode

  if (!account) {
    content = <LoginScreen />
  } else if (activeGroup) {
    content = (
      <LocalGroupChatPanel
        group={activeGroup}
        friends={friends}
        account={account}
        messages={groupMessages[activeGroup.id] || []}
        onClose={() => setActiveGroupId(null)}
        onSend={(content) => sendGroupMessage(activeGroup.id, content)}
        onInviteFriend={inviteFriendToGroup}
        onLeaveGroup={leaveGroup}
        onEditMessage={editGroupMessage}
        onDeleteMessage={deleteGroupMessage}
      />
    )
  } else if (showGlobalChat) {
    content = <ChatPanel global onClose={() => setShowGlobalChat(false)} />
  } else if (activeFriend) {
    content = <ChatPanel friend={activeFriend} onClose={() => setActiveChat(null)} />
  } else if (showAddFriends) {
    content = (
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
    )
  } else if (showGroups) {
    content = <GroupsPanel groups={groups} friends={friends} onOpenGroup={(id) => { setActiveGroupId(id); setShowGroups(false) }} onCreateGroup={createGroup} onBack={() => setShowGroups(false)} />
  } else {
    content = (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-3 flex flex-col gap-3 border-b border-white/10">
          <div className="flex items-start gap-3 min-w-0">
            <Avatar avatar={account.avatar} username={account.username} size={38} />
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="font-semibold leading-tight break-words [overflow-wrap:anywhere]">{account.username}</p>
              <p className="text-xs text-white/50 mt-0.5">{connected ? t('friends.connected') : t('friends.connecting')}</p>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <div className="relative">
              <Button
                className="w-full"
                variant="tertiary"
                size="sm"
                onPress={() => setShowAddFriends(true)}
                aria-label={t('friends.addFriend')}
              >
                <IconUserPlus className="size-4" />
              </Button>
              {incoming.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-red-500 border-2 border-surface pointer-events-none" />
              )}
            </div>
            <Button className="w-full" variant="tertiary" size="sm" onPress={openGlobalChat} aria-label="Chat global">
              <IconWorld className="size-4" />
            </Button>
            <Button className="w-full" variant="tertiary" size="sm" onPress={openGroups} aria-label={t('friends.groups')}>
              <IconUsers className="size-4" />
            </Button>
            <Button className="w-full" variant="tertiary" size="sm" onPress={logout} aria-label={t('friends.logout')}>
              <IconLogout className="size-4" />
            </Button>
            <Button className="w-full" variant="tertiary" size="sm" onPress={close} aria-label={t('friends.closeChat')}>
              <IconX className="size-4" />
            </Button>
          </div>
        </div>

        {openChats.length > 0 && (
          <div className="p-3 border-b border-white/10 max-h-44 overflow-y-auto shrink-0">
            <p className="text-xs uppercase text-white/40 mb-2">{t('friends.directMessages') ?? 'Mensajes directos'}</p>
            {openChats.map((id) => {
              const f = friends.find((fr) => fr.id === id)
              if (!f) return null
              return (
                <div
                  key={f.id}
                  onClick={() => openChat(f.id)}
                  className={`group flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-white/5 ${
                    activeChat === f.id ? 'bg-white/10' : ''
                  }`}
                >
                  <Avatar avatar={f.avatar} username={f.username} size={30} />
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

        <FriendsPanel
          friends={friends}
          onOpenChat={openChat}
          onRemoveFriend={(id) => { removeFriend(id).catch(() => {}); closeChat(id) }}
        />
      </div>
    )
  }

  return (
    <div
      className="fixed right-0 z-50 flex items-stretch transition-transform duration-300 ease-out pointer-events-none"
      style={{
        top: 40,                    
        height: 'calc(100% - 40px)', 
        width: PANEL_WIDTH,
        transform: isOpen ? 'translateX(0)' : `translateX(${PANEL_WIDTH}px)`,
      }}
    >
      <div
        className="w-full h-full bg-surface backdrop-blur-md border-l border-t border-border flex flex-col overflow-hidden shadow-2xl text-white pointer-events-auto"
      >
        {content}
      </div>
    </div>
  )
}
