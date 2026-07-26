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
  IconExternalLink,
  IconSearch,
  IconUpload,
  IconLogout,
  IconTrophy,
} from '@tabler/icons-react'
import { useLauncherTranslation } from '../utils/languageContext'
import { useModstack } from '../stores/modstackContext'
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
import { MiniViewer } from './Skins'
import { getActiveId, loadAllSkins, MODSTACK_SOCIAL_SERVER_URL, uploadSocialMediaToModstack, type ArmStyle } from '../utils/skinsStore'
import { useAuth } from '../stores/authContext'
import { getMinecraftProfile, getSkinModelFromProfile, getSkinUrl, getSkinUrlFromProfile } from '../utils/mojang'
import { loadLocalInstances, type LocalInstance } from '../utils/localInstances'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'

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
const PROFILE_SYNC_PREFIX = 'MODSTACK_PROFILE_SYNC:'
type SocialTab = 'friends' | 'messages' | 'requests'

interface LocalChatGroup {
  id: string
  name: string
  createdAt: string
  memberIds: string[]
}

interface SocialProfileLinks {
  minecraft: string
  twitch: string
  youtube: string
  twitter: string
  modrinth: string
}

interface SocialProfileTarget {
  id: string
  username: string
  avatar: string | null
  created_at?: string | null
  createdAt?: string | null
  bio?: string | null
  displayName?: string | null
}

const SOCIAL_PROFILE_LINKS_KEY = 'modstack.social.profileLinks'
const SOCIAL_BANNER_KEY = 'modstack.social.bannerOverride'
const SOCIAL_MEMBER_SINCE_KEY = 'modstack.social.memberSince'
const SOCIAL_PROFILE_META_KEY = 'modstack.social.profileMeta'
const SOCIAL_PLAYED_INSTANCES_KEY = 'modstack.social.playedInstances'
const SOCIAL_FRIENDS_KEY = 'modstack.social.friendsByUser'
const SOCIAL_PROFILE_SYNC_HASH_KEY = 'modstack.social.profileSyncHash'
const SOCIAL_LINKED_PROVIDERS_KEY = 'modstack.social.linkedProviders'
const SOCIAL_ACHIEVEMENTS_SEEN_KEY = 'modstack.social.achievementsSeen'
const SOCIAL_ACHIEVEMENTS_STEAM_MIGRATION_KEY = 'modstack.social.achievementsSteamToast.v1'
const PROFILE_SYNC_VERSION = 2
const PROFILE_BIO_MAX_LENGTH = 128
const PROFILE_USERNAME_MAX_LENGTH = 16
const PROFILE_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

type PlayedProfileInstance = {
  name: string
  loader?: string
  minecraftVersion?: string
  playtime?: number
  backgroundUrl?: string
  backgroundDataUrl?: string
}

type SocialProfileMeta = {
  username: string
  bio: string
}

type LinkedProviders = {
  discord?: boolean
  google?: boolean
}

type ProfileSyncPayload = {
  meta?: SocialProfileMeta
  playedInstances?: PlayedProfileInstance[]
  playedTotal?: number
  linkedProviders?: LinkedProviders
  bannerUrl?: string | null
  skin?: {
    dataUrl?: string
    armStyle?: ArmStyle
  }
  updatedAt?: string
  version?: number
}

type ProfileAchievement = {
  id: string
  title: string
  description: string
  unlocked: boolean
}

function loadProfileMeta(userId?: string | null, fallbackUsername = ''): SocialProfileMeta {
  if (!userId) return { username: fallbackUsername, bio: '' }
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_PROFILE_META_KEY) || '{}')
    const meta = parsed[userId] && typeof parsed[userId] === 'object' ? parsed[userId] : {}
    return {
      username: String(meta.username || fallbackUsername),
      bio: String(meta.bio || ''),
    }
  } catch {
    return { username: fallbackUsername, bio: '' }
  }
}

function saveProfileMeta(userId: string, meta: SocialProfileMeta) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_PROFILE_META_KEY) || '{}')
    parsed[userId] = meta
    localStorage.setItem(SOCIAL_PROFILE_META_KEY, JSON.stringify(parsed))
  } catch {}
}

function profileDraftFromUser(user: SocialProfileTarget): SocialProfileMeta {
  const meta = loadProfileMeta(user.id, user.displayName || user.username)
  return {
    username: user.username,
    bio: meta.bio,
  }
}

function loadProfilePlayedInstances(userId?: string | null): PlayedProfileInstance[] {
  if (!userId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_PLAYED_INSTANCES_KEY) || '{}')
    return Array.isArray(parsed[userId]) ? parsed[userId] : []
  } catch {
    return []
  }
}

function saveProfilePlayedInstances(userId: string, instances: PlayedProfileInstance[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_PLAYED_INSTANCES_KEY) || '{}')
    parsed[userId] = instances
    localStorage.setItem(SOCIAL_PLAYED_INSTANCES_KEY, JSON.stringify(parsed))
  } catch {}
}

function loadLinkedProviders(userId?: string | null): LinkedProviders {
  if (!userId) return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_LINKED_PROVIDERS_KEY) || '{}')
    return parsed[userId] && typeof parsed[userId] === 'object' ? parsed[userId] : {}
  } catch {
    return {}
  }
}

function loadProfileFriends(userId?: string | null): ModstackFriend[] {
  if (!userId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_FRIENDS_KEY) || '{}')
    return Array.isArray(parsed[userId]) ? parsed[userId] : []
  } catch {
    return []
  }
}

function saveProfileFriends(userId: string, friends: ModstackFriend[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_FRIENDS_KEY) || '{}')
    parsed[userId] = friends.map((friend) => ({
      id: friend.id,
      username: friend.username,
      avatar: friend.avatar,
      created_at: friend.created_at ?? null,
      createdAt: friend.createdAt ?? null,
      bio: friend.bio ?? null,
      displayName: friend.displayName ?? null,
      status: friend.status,
      activity: friend.activity,
    }))
    localStorage.setItem(SOCIAL_FRIENDS_KEY, JSON.stringify(parsed))
  } catch {}
}

function sameProfileName(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())
}

function memberSinceFallback(userId?: string | null) {
  if (!userId) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_MEMBER_SINCE_KEY) || '{}')
    if (typeof parsed[userId] === 'string') return parsed[userId] as string
    const created = new Date().toISOString()
    parsed[userId] = created
    localStorage.setItem(SOCIAL_MEMBER_SINCE_KEY, JSON.stringify(parsed))
    return created
  } catch {
    return null
  }
}

function loadBannerOverride(userId?: string | null) {
  if (!userId) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_BANNER_KEY) || '{}')
    return typeof parsed[userId] === 'string' ? parsed[userId] as string : null
  } catch {
    return null
  }
}

function saveBannerOverride(userId: string, value: string | null) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_BANNER_KEY) || '{}')
    if (value) parsed[userId] = value
    else delete parsed[userId]
    localStorage.setItem(SOCIAL_BANNER_KEY, JSON.stringify(parsed))
  } catch {}
}

function loadProfileLinks(): SocialProfileLinks {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_PROFILE_LINKS_KEY) || '{}')
    return {
      minecraft: String(parsed.minecraft || ''),
      twitch: String(parsed.twitch || ''),
      youtube: String(parsed.youtube || ''),
      twitter: String(parsed.twitter || ''),
      modrinth: String(parsed.modrinth || ''),
    }
  } catch {
    return { minecraft: '', twitch: '', youtube: '', twitter: '', modrinth: '' }
  }
}

function saveProfileLinks(links: SocialProfileLinks) {
  localStorage.setItem(SOCIAL_PROFILE_LINKS_KEY, JSON.stringify(links))
}

function getSocialBannerCandidates(userId: string, override?: string | null) {
  const base = `${MODSTACK_SOCIAL_SERVER_URL}/media/banners/${encodeURIComponent(userId)}`
  return [
    override,
    `${base}.png`,
    `${base}.jpg`,
    `${base}.webp`,
    `${base}.gif`,
  ].filter(Boolean) as string[]
}

function formatMemberSince(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
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

function encodeJsonPayload(value: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
}

function decodeJsonPayload<T>(value: string): T | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(value)))) as T
  } catch {
    return null
  }
}

function createProfileSyncMessage(
  meta: SocialProfileMeta,
  playedInstances: PlayedProfileInstance[],
  playedTotal = playedInstances.length,
  linkedProviders: LinkedProviders = {},
  bannerUrl?: string | null,
  skin?: ProfileSyncPayload['skin'] | null,
) {
  return `${PROFILE_SYNC_PREFIX}${encodeJsonPayload({
    version: PROFILE_SYNC_VERSION,
    meta,
    playedInstances: playedInstances.slice(0, 4),
    playedTotal,
    linkedProviders,
    bannerUrl: bannerUrl ?? null,
    skin: skin?.dataUrl ? skin : null,
    updatedAt: new Date().toISOString(),
  })}`
}

function parseProfileSyncMessage(content: string): ProfileSyncPayload | null {
  const value = content.trim()
  if (!value.startsWith(PROFILE_SYNC_PREFIX)) return null
  return decodeJsonPayload(value.slice(PROFILE_SYNC_PREFIX.length))
}

function isProfileSyncMessage(content: string) {
  return content.trim().startsWith(PROFILE_SYNC_PREFIX)
}

function latestProfileSyncFromMessages(messages: ChatMessage[], userId: string) {
  return messages
    .filter((message) => message.senderId === userId)
    .map((message) => parseProfileSyncMessage(message.content))
    .filter((sync): sync is NonNullable<typeof sync> => Boolean(sync))
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0] ?? null
}

function playedInstanceBackground(instance: PlayedProfileInstance) {
  return instance.backgroundDataUrl || instance.backgroundUrl
}

function shrinkSkinForProfile(dataUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const context = canvas.getContext('2d')
        if (!context) return resolve(undefined)
        context.imageSmoothingEnabled = false
        context.drawImage(image, 0, 0, 64, 64)
        const webp = canvas.toDataURL('image/webp', 0.78)
        resolve(webp.length < 14000 ? webp : dataUrl.length < 18000 ? dataUrl : undefined)
      } catch {
        resolve(dataUrl.length < 18000 ? dataUrl : undefined)
      }
    }
    image.onerror = () => resolve(dataUrl.length < 18000 ? dataUrl : undefined)
    image.src = dataUrl
  })
}

async function loadActiveProfileSkin() {
  try {
    const [skins, activeId] = await Promise.all([loadAllSkins(), getActiveId()])
    const skin = activeId ? skins.find((item) => item.id === activeId) ?? null : null
    if (!skin) return null
    return {
      dataUrl: await shrinkSkinForProfile(skin.dataUrl),
      armStyle: skin.armStyle,
    }
  } catch {
    return null
  }
}

async function resolveOnlineProfileSkin(username: string) {
  try {
    const profile = await getMinecraftProfile(username)
    const skinUrl = getSkinUrlFromProfile(profile)
    if (skinUrl && !/\/?steve\.png$/i.test(skinUrl)) {
      return {
        skinUrl,
        armStyle: getSkinModelFromProfile(profile) === 'slim' ? 'slim' as ArmStyle : 'wide' as ArmStyle,
      }
    }
  } catch {}

  try {
    const dataUrl = await invoke<string>('fetch_skin_as_base64', { url: `${getSkinUrl(username)}/texture` })
    return { skinUrl: dataUrl, armStyle: 'wide' as ArmStyle }
  } catch {
    return null
  }
}

function loadPreviewImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

async function makePortableBackground(path?: string | null) {
  if (!path) return undefined
  try {
    const image = await loadPreviewImage(convertFileSrc(path))
    const width = 136
    const height = 76
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return undefined
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
    const drawWidth = image.naturalWidth * scale
    const drawHeight = image.naturalHeight * scale
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    const dataUrl = canvas.toDataURL('image/webp', 0.28)
    return dataUrl.length < 9000 ? dataUrl : undefined
  } catch {
    return undefined
  }
}

function buildProfileAchievements(
  t: ReturnType<typeof useLauncherTranslation>,
  playedCount: number,
  instances: PlayedProfileInstance[],
  profileFriends: ModstackFriend[],
  displayBio: string,
  avatar?: string | null,
  username?: string | null
): ProfileAchievement[] {
  const hasModpack = instances.some((instance) => {
    const loader = (instance.loader || '').toLowerCase()
    return loader && loader !== 'vanilla'
  })
  const normalizedUsername = (username || '').trim().toLowerCase()
  const isModstackCreator = normalizedUsername === 'primecigarrete'
  return [
    {
      id: 'creator',
      title: t('friends.achievementCreator'),
      description: t('friends.achievementCreatorDesc'),
      unlocked: isModstackCreator,
    },
    {
      id: 'discord',
      title: t('friends.achievementDiscord'),
      description: t('friends.achievementDiscordDesc'),
      unlocked: false,
    },
    {
      id: 'google',
      title: t('friends.achievementGoogle'),
      description: t('friends.achievementGoogleDesc'),
      unlocked: false,
    },
    {
      id: 'avatar',
      title: t('friends.achievementAvatar'),
      description: t('friends.achievementAvatarDesc'),
      unlocked: Boolean(avatar),
    },
    {
      id: 'bio',
      title: t('friends.achievementBio'),
      description: t('friends.achievementBioDesc'),
      unlocked: displayBio.trim().length > 0,
    },
    {
      id: 'friend',
      title: t('friends.achievementFriend'),
      description: t('friends.achievementFriendDesc'),
      unlocked: profileFriends.length > 0,
    },
    {
      id: 'instance',
      title: t('friends.achievementInstance'),
      description: t('friends.achievementInstanceDesc'),
      unlocked: playedCount > 0,
    },
    {
      id: 'ten-instances',
      title: t('friends.achievementTenInstances'),
      description: t('friends.achievementTenInstancesDesc'),
      unlocked: playedCount >= 10,
    },
    {
      id: 'modpack',
      title: t('friends.achievementModpack'),
      description: t('friends.achievementModpackDesc'),
      unlocked: hasModpack,
    },
  ]
}

function loadSeenAchievements(userId?: string | null): string[] {
  if (!userId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_ACHIEVEMENTS_SEEN_KEY) || '{}')
    return Array.isArray(parsed[userId]) ? parsed[userId].map(String) : []
  } catch {
    return []
  }
}

function saveSeenAchievements(userId: string, achievementIds: string[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_ACHIEVEMENTS_SEEN_KEY) || '{}')
    parsed[userId] = [...new Set(achievementIds)]
    localStorage.setItem(SOCIAL_ACHIEVEMENTS_SEEN_KEY, JSON.stringify(parsed))
  } catch {}
}

function resetCreatorAchievementToastOnce(userId?: string | null) {
  if (!userId) return
  const migrationKey = `${SOCIAL_ACHIEVEMENTS_STEAM_MIGRATION_KEY}.${userId}`
  if (localStorage.getItem(migrationKey)) return
  try {
    const parsed = JSON.parse(localStorage.getItem(SOCIAL_ACHIEVEMENTS_SEEN_KEY) || '{}')
    if (Array.isArray(parsed[userId])) {
      parsed[userId] = parsed[userId].filter((id: string) => id !== 'creator')
      localStorage.setItem(SOCIAL_ACHIEVEMENTS_SEEN_KEY, JSON.stringify(parsed))
    }
    localStorage.setItem(migrationKey, '1')
  } catch {}
}

function playAchievementSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.72)
    gain.connect(context.destination)

    ;[523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.08)
      oscillator.connect(gain)
      oscillator.start(context.currentTime + index * 0.08)
      oscillator.stop(context.currentTime + 0.62 + index * 0.05)
    })
    setTimeout(() => context.close().catch(() => {}), 900)
  } catch {}
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
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-[var(--color-page-background)] px-6 text-white">
      <div className="mb-8 grid size-16 place-items-center rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_srgb,var(--color-accent)_28%,transparent),rgba(255,255,255,0.045)_48%,rgba(255,255,255,0.02))] shadow-[0_24px_80px_rgba(0,0,0,0.38)]">
        <IconUsers className="size-7 text-white/85" />
      </div>

      <h2 className="text-xl font-black text-center">{t('friends.loginConnectTitle')}</h2>
      <p className="mt-3 max-w-64 text-center text-sm leading-relaxed text-white/35">
        {t('friends.loginConnectDesc')}
      </p>
      {isWaitingLogin ? (
        <p className="mt-8 text-sm text-white/70 animate-pulse">{t('friends.loginWaiting')}</p>
      ) : (
        <div className="mt-8 flex w-full max-w-64 flex-col gap-3">
          <button
            type="button"
            onClick={() => doLogin('google')}
            className="flex h-12 items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] text-sm font-bold text-white/80 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
          >
            <IconBrandGoogleFilled className="size-5" />
            Google
          </button>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[11px] font-bold text-white/18">o</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <button
            type="button"
            onClick={() => doLogin('discord')}
            className="flex h-12 items-center justify-center gap-3 rounded-2xl border border-[#5865f2]/20 bg-[#5865f2]/10 text-sm font-bold text-[#b9c0ff] transition-all hover:border-[#5865f2]/35 hover:bg-[#5865f2]/16 hover:text-white"
          >
            <DiscordIcon size={18} />
            Discord
          </button>
        </div>
      )}
      <p className="mt-9 max-w-52 text-center text-[11px] leading-relaxed text-white/[0.12]">
        {t('friends.loginLocalWarning')}
      </p>
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
    if (sending) return
    const name = addName.trim()
    if (!name) return
    if (outgoing.some((request) => request.username.toLowerCase() === name.toLowerCase())) return
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
            onChange={(e) => setAddName(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, PROFILE_USERNAME_MAX_LENGTH))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !sending) doAdd() }}
            maxLength={16}
            placeholder="Username..."
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/30"
          />
          <Button size="sm" isDisabled={sending || !PROFILE_USERNAME_PATTERN.test(addName.trim())} onPress={doAdd}>
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
              className="text-white/35 hover:text-white/75"
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

void FriendsPanel

function SocialBannerImage({ urls }: { urls: string[] }) {
  const [index, setIndex] = useState(0)
  const src = urls[index]

  useEffect(() => setIndex(0), [urls.join('|')])

  if (!src) {
    return (
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_34%_14%,color-mix(in_srgb,var(--color-accent)_28%,transparent),transparent_32%),radial-gradient(circle_at_76%_12%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.01))]" />
    )
  }

  return (
    <img
      src={src}
      alt=""
      className="absolute inset-0 h-full w-full object-cover opacity-45"
      onError={() => setIndex((current) => current + 1)}
    />
  )
}

function SocialSkinPreview({
  className = '',
  useActiveSkin = true,
  minecraftName,
  syncedSkin,
}: {
  className?: string
  useActiveSkin?: boolean
  minecraftName?: string | null
  syncedSkin?: ProfileSyncPayload['skin'] | null
}) {
  const [skinUrl, setSkinUrl] = useState('./steve.png')
  const [armStyle, setArmStyle] = useState<ArmStyle>('wide')

  useEffect(() => {
    let active = true
    ;(async () => {
      if (syncedSkin?.dataUrl) {
        setSkinUrl(syncedSkin.dataUrl)
        setArmStyle(syncedSkin.armStyle === 'slim' ? 'slim' : 'wide')
        return
      }

      if (useActiveSkin) {
        try {
          const [skins, activeId] = await Promise.all([loadAllSkins(), getActiveId()])
          const skin = activeId ? skins.find((item) => item.id === activeId) ?? null : null
          if (skin) {
            if (!active) return
            setSkinUrl(skin.dataUrl)
            setArmStyle(skin.armStyle)
            return
          }
        } catch {}
      }

      if (minecraftName) {
        const onlineSkin = await resolveOnlineProfileSkin(minecraftName)
        if (onlineSkin) {
          if (!active) return
          setSkinUrl(onlineSkin.skinUrl)
          setArmStyle(onlineSkin.armStyle)
          return
        }
      }

      if (!active) return
      setSkinUrl('./steve.png')
      setArmStyle('wide')
    })()
    return () => { active = false }
  }, [minecraftName, syncedSkin?.dataUrl, syncedSkin?.armStyle, useActiveSkin])

  return (
    <div className={`pointer-events-none flex items-start justify-center overflow-hidden ${className}`}>
      <div className="translate-y-2">
        <MiniViewer
          skinUrl={skinUrl}
          armStyle={armStyle}
          width={220}
          height={300}
          cameraDistance={4.4}
          cameraY={1.4}
          lookAtY={1}
          initialRotation={0.38}
        />
      </div>
    </div>
  )
}

function StatusDot({ friend }: { friend: ModstackFriend }) {
  const presence = parsePresence(friend.status, friend.activity)
  const color =
    presence.kind === 'playing' || presence.kind === 'listening'
      ? 'bg-accent'
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

function getPlayedInstances(friend: ModstackFriend | null, messages: ChatMessage[], localPlayed: PlayedProfileInstance[] = []) {
  const byName = new Map<string, PlayedProfileInstance>()
  for (const instance of localPlayed) {
    byName.set(instance.name, instance)
  }

  const presence = friend ? parsePresence(friend.status, friend.activity) : null
  if (presence?.kind === 'playing' && presence.text && !byName.has(presence.text)) {
    byName.set(presence.text, { name: presence.text })
  }

  for (const message of messages) {
    const share = parseInstanceShareMessage(message.content)
    if (share?.payload?.title && !byName.has(share.payload.title)) {
      byName.set(share.payload.title, {
        name: share.payload.title,
        loader: share.payload.loader,
        minecraftVersion: share.payload.minecraft_version,
      })
    }
  }

  return [...byName.values()].slice(0, 4)
}

function SocialProfilePanel({
  user,
  friend,
  messages,
  friends,
  editable = false,
  bannerOverride,
  onBannerChange,
  onBack,
  onOpenChat,
  onOpenProfile,
  onAddFriend,
  onRemoveFriend,
  onProfileSync,
}: {
  user: SocialProfileTarget
  friend?: ModstackFriend | null
  messages: ChatMessage[]
  friends: ModstackFriend[]
  editable?: boolean
  bannerOverride?: string | null
  onBannerChange?: (value: string | null) => void
  onBack: () => void
  onOpenChat?: (id: string) => void
  onOpenProfile?: (user: SocialProfileTarget) => void
  onAddFriend?: (username: string) => void
  onRemoveFriend?: (id: string) => void
  onProfileSync?: (meta: SocialProfileMeta, playedInstances: PlayedProfileInstance[], playedTotal?: number, linkedProviders?: LinkedProviders, bannerUrl?: string | null) => void
}) {
  const t = useLauncherTranslation()
  const { account, uploadAvatar, updateProfile } = useModstack()
  const { user: minecraftUser } = useAuth()
  const [editing, setEditing] = useState(false)
  const [links, setLinks] = useState<SocialProfileLinks>(loadProfileLinks)
  const [profileMeta, setProfileMeta] = useState<SocialProfileMeta>(() => profileDraftFromUser(user))
  const [draftMeta, setDraftMeta] = useState<SocialProfileMeta>(() => profileDraftFromUser(user))
  const [localPlayedInstances, setLocalPlayedInstances] = useState<PlayedProfileInstance[]>(() => loadProfilePlayedInstances(user.id))
  const [localPlayedTotal, setLocalPlayedTotal] = useState(() => loadProfilePlayedInstances(user.id).length)
  const [cachedProfileFriends, setCachedProfileFriends] = useState<ModstackFriend[]>(() => loadProfileFriends(user.id))
  const [linkedProviders, setLinkedProviders] = useState<LinkedProviders>(() => loadLinkedProviders(user.id))
  const [achievementsOpen, setAchievementsOpen] = useState(false)
  const [achievementToast, setAchievementToast] = useState<ProfileAchievement | null>(null)
  const achievementToastSessionRef = useRef<Set<string>>(new Set())
  const avatarFileRef = useRef<HTMLInputElement>(null)
  const bannerFileRef = useRef<HTMLInputElement>(null)
  const isFriend = Boolean(friend)
  const presence = friend
    ? parsePresence(friend.status, friend.activity)
    : editable
      ? { kind: 'online' as const, text: null }
      : { kind: 'offline' as const, text: null }
  const profileStatus = editable
    ? t('friends.connected')
    : friend
      ? <FriendStatus friend={friend} />
      : t('friends.profileActive')
  const memberSince = formatMemberSince(user.created_at ?? user.createdAt ?? memberSinceFallback(user.id))
  const inferredMutualFriend: ModstackFriend | null =
    !editable && friend && account
      ? {
          ...account,
          status: 'online',
          activity: null,
        }
      : null
  const profileFriends = editable
    ? friends
    : inferredMutualFriend
      ? [
          inferredMutualFriend,
          ...cachedProfileFriends.filter((item) => item.id !== inferredMutualFriend.id),
        ]
      : cachedProfileFriends
  const visibleLinks = editable ? links : { minecraft: user.username, twitch: '', youtube: '', twitter: '', modrinth: '' }
  const remoteProfileSync = latestProfileSyncFromMessages(messages, user.id)
  const syncedMeta = remoteProfileSync?.meta
  const syncedPlayedInstances = remoteProfileSync?.playedInstances ?? []
  const displayBannerUrls = getSocialBannerCandidates(
    user.id,
    editable ? (bannerOverride ?? loadBannerOverride(user.id)) : remoteProfileSync?.bannerUrl,
  )
  const displayUsername = editable
    ? user.username
    : syncedMeta?.username || user.displayName || user.username
  const displayBio = ((editable ? profileMeta.bio : syncedMeta?.bio) || user.bio || '').slice(0, PROFILE_BIO_MAX_LENGTH)
  const activeMinecraftName = minecraftUser?.minecraft?.name ?? null
  const localMinecraftOwner =
    activeMinecraftName
      ? ([user, ...friends] as SocialProfileTarget[]).find((candidate) =>
          sameProfileName(candidate.username, activeMinecraftName) ||
          sameProfileName(candidate.displayName, activeMinecraftName) ||
          sameProfileName(loadProfileMeta(candidate.id, candidate.username).username, activeMinecraftName)
        )
      : null
  const localMinecraftOwnerId = localMinecraftOwner?.id ?? null
  const isLocalMinecraftProfile = Boolean(localMinecraftOwnerId && user.id === localMinecraftOwnerId)
  const minecraftName = isLocalMinecraftProfile ? activeMinecraftName : displayUsername
  const instances = getPlayedInstances(friend ?? null, messages, isLocalMinecraftProfile ? localPlayedInstances : syncedPlayedInstances)
  const playedTotal = isLocalMinecraftProfile ? localPlayedTotal : remoteProfileSync?.playedTotal ?? instances.length
  const achievements = useMemo(
    () => buildProfileAchievements(t, playedTotal, instances, profileFriends, displayBio, user.avatar, displayUsername || user.username),
    [t, playedTotal, instances, profileFriends, displayBio, user.avatar, displayUsername, user.username]
  )
  const unlockedAchievements = achievements.filter((achievement) => achievement.unlocked).length

  useEffect(() => {
    achievementToastSessionRef.current = new Set()
    if (editable) resetCreatorAchievementToastOnce(user.id)
  }, [user.id])

  useEffect(() => {
    if (!editable) return
    const unlockedIds = achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.id)
    const seenIds = loadSeenAchievements(user.id)
    const nextAchievement = achievements.find((achievement) =>
      achievement.unlocked &&
      !seenIds.includes(achievement.id) &&
      !achievementToastSessionRef.current.has(achievement.id)
    )
    if (!nextAchievement) return
    achievementToastSessionRef.current.add(nextAchievement.id)
    saveSeenAchievements(user.id, [...seenIds, nextAchievement.id, ...unlockedIds.filter((id) => seenIds.includes(id))])
    setAchievementToast(nextAchievement)
    playAchievementSound()
  }, [editable, user.id, achievements])

  useEffect(() => {
    if (!achievementToast) return
    const timeout = window.setTimeout(() => setAchievementToast(null), 5200)
    return () => window.clearTimeout(timeout)
  }, [achievementToast])

  useEffect(() => {
    const meta = profileDraftFromUser(user)
    setProfileMeta(meta)
    setDraftMeta(meta)
    setLocalPlayedInstances(localMinecraftOwnerId === user.id ? loadProfilePlayedInstances(user.id) : [])
    setLocalPlayedTotal(localMinecraftOwnerId === user.id ? loadProfilePlayedInstances(user.id).length : remoteProfileSync?.playedTotal ?? 0)
    setCachedProfileFriends(loadProfileFriends(user.id))
    setLinkedProviders(loadLinkedProviders(user.id))
  }, [user.id, user.username, user.displayName, localMinecraftOwnerId, remoteProfileSync?.playedTotal])

  useEffect(() => {
    if (!editable) return
    saveProfileFriends(user.id, friends)
    setCachedProfileFriends(friends)
  }, [editable, user.id, friends])

  useEffect(() => {
    if (!localMinecraftOwnerId) {
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const localInstances = await loadLocalInstances()
        const played = await Promise.all(
          localInstances.map(async (instance: LocalInstance) => ({
            instance,
            playtime: await invoke<number>('get_instance_playtime', { instanceId: instance.id }).catch(() => 0),
          }))
        )
        if (cancelled) return
        const playedSorted = played
          .filter(({ playtime }) => playtime > 0)
          .sort((a, b) => (b.playtime - a.playtime) || (b.instance.created_at - a.instance.created_at))
        const nextPlayed = await Promise.all(
          playedSorted
            .slice(0, 4)
            .map(async ({ instance, playtime }) => ({
              name: instance.title,
              loader: instance.loader,
              minecraftVersion: instance.minecraft_version,
              playtime,
              backgroundUrl: instance.background_path ? convertFileSrc(instance.background_path) : undefined,
              backgroundDataUrl: await makePortableBackground(instance.background_path),
            }))
        )
        saveProfilePlayedInstances(localMinecraftOwnerId, nextPlayed)
        if (user.id === localMinecraftOwnerId) {
          setLocalPlayedInstances(nextPlayed)
          setLocalPlayedTotal(playedSorted.length)
        }
        if (editable && user.id === localMinecraftOwnerId) onProfileSync?.(profileMeta, nextPlayed, playedSorted.length, linkedProviders)
      } catch {
        if (!cancelled && user.id === localMinecraftOwnerId) {
          setLocalPlayedInstances(loadProfilePlayedInstances(localMinecraftOwnerId))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [localMinecraftOwnerId, user.id, editable, profileMeta, linkedProviders, onProfileSync])

  const updateLink = (key: keyof SocialProfileLinks, value: string) => {
    setLinks((prev) => ({ ...prev, [key]: value }))
  }

  const saveLinks = async () => {
    const username = draftMeta.username.trim()
    if (!PROFILE_USERNAME_PATTERN.test(username)) {
      toast.danger(t('friends.profileSaved'), { description: 'Username must be 3-16 characters: letters, numbers and _' })
      return
    }
    const nextMeta = {
      username,
      bio: draftMeta.bio.trim().slice(0, PROFILE_BIO_MAX_LENGTH),
    }
    saveProfileLinks(links)
    try {
      const savedUser = await updateProfile(nextMeta)
      const savedMeta = { ...nextMeta, username: savedUser.username }
      saveProfileMeta(user.id, savedMeta)
      setProfileMeta(savedMeta)
      setDraftMeta(savedMeta)
      onProfileSync?.(savedMeta, localPlayedInstances, localPlayedTotal, linkedProviders, bannerOverride ?? loadBannerOverride(user.id))
      setEditing(false)
      toast(t('friends.profileSaved'))
    } catch (error) {
      toast.danger(t('friends.profileSaved'), { description: String((error as Error).message) })
    }
  }

  const changeBanner = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      const result = await uploadSocialMediaToModstack(String(reader.result), user.id, 'banner')
      if (!result.ok || !result.url) {
        toast.danger(t('friends.profileSaved'), { description: result.error || 'Upload failed' })
        return
      }
      onBannerChange?.(result.url)
      onProfileSync?.(profileMeta, localPlayedInstances, localPlayedTotal, linkedProviders, result.url)
    }
    reader.readAsDataURL(file)
  }

  const changeAvatar = async (file?: File) => {
    if (!file) return
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    if (!allowed.includes(file.type)) {
      toast.danger(t('friends.profileSaved'), { description: 'Only PNG, JPEG, WEBP, or GIF files are allowed.' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.danger(t('friends.profileSaved'), { description: 'Max file size is 5MB.' })
      return
    }
    try {
      await uploadAvatar(file)
      toast(t('friends.profileSaved'))
    } catch (error) {
      toast.danger(t('friends.profileSaved'), { description: String((error as Error).message) })
    } finally {
      if (avatarFileRef.current) avatarFileRef.current.value = ''
    }
  }

  const networkRows: { key: keyof SocialProfileLinks; label: string; value: string }[] = [
    { key: 'twitch', label: 'Twitch', value: visibleLinks.twitch },
    { key: 'youtube', label: 'YouTube', value: visibleLinks.youtube },
    { key: 'twitter', label: 'Twitter / X', value: visibleLinks.twitter },
    { key: 'modrinth', label: 'Modrinth', value: visibleLinks.modrinth },
  ]

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--color-page-background)] text-white">
      <div className="sticky top-0 z-30 flex items-center justify-between px-8 py-5">
        <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm text-white/45 transition-colors hover:text-white">
          <IconArrowLeft className="size-4" />
          {t('friends.back')}
        </button>
        {editable && (
          <div className="flex gap-2">
            <input ref={avatarFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => changeAvatar(event.target.files?.[0])} />
            <input ref={bannerFileRef} type="file" accept="image/*" className="hidden" onChange={(event) => changeBanner(event.target.files?.[0])} />
            <Button size="sm" variant="tertiary" className="border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white" onPress={() => setEditing(true)}>
              <IconEdit className="size-3.5" />
              {t('friends.editProfile')}
            </Button>
          </div>
        )}
      </div>

      <div className="relative mx-8 min-h-[340px] overflow-visible rounded-[28px] border border-white/[0.06] bg-[#0c0d10] px-7 pb-7">
        <div className="absolute inset-0 overflow-hidden rounded-[28px]">
          <SocialBannerImage urls={displayBannerUrls} />
          <div className="absolute inset-0 bg-gradient-to-b from-[#09090b]/10 via-[#09090b]/28 to-[#09090b]/90" />
        </div>
        <SocialSkinPreview
          minecraftName={minecraftName}
          syncedSkin={!editable ? remoteProfileSync?.skin : null}
          useActiveSkin={editable || isLocalMinecraftProfile}
          className="absolute left-1/2 top-4 h-72 w-64 -translate-x-1/2 opacity-95"
        />
        <button
          type="button"
          onClick={() => setAchievementsOpen(true)}
          className="absolute right-5 top-5 z-20 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-black text-white/70 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/35 hover:bg-accent/15 hover:text-white"
        >
          <IconTrophy className="size-4 text-accent" />
          {t('friends.achievements')}
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/55">{unlockedAchievements}/{achievements.length}</span>
        </button>
        <div className="relative flex min-h-[310px] items-end justify-between gap-6">
          <div className="flex items-end gap-4">
            <div className="relative">
              <Avatar avatar={user.avatar} username={user.username} size={66} />
              {(editable || friend) && (
                <span className="absolute -right-1 bottom-1">
                  <StatusDot friend={friend ?? { ...user, status: 'online', activity: null }} />
                </span>
              )}
            </div>
            <div className="relative pb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-3xl font-black tracking-tight">{displayUsername}</h2>
                <span className="size-2.5 rounded-full bg-white/25" />
              </div>
              <p className="mt-1 text-sm text-white/40">{profileStatus}</p>
              <p className="mt-1 text-[11px] text-white/28">{memberSince ? `${t('friends.memberSince')} ${memberSince}` : t('friends.profileActive')}</p>
              {displayBio && (
                <div className="absolute left-0 top-full mt-3 w-max max-w-[min(42rem,calc(100vw-4rem))]">
                  <span className="absolute -left-5 -top-1 size-3 rounded-full border border-white/[0.08] bg-white/[0.08] shadow-[0_8px_20px_rgba(0,0,0,0.25)]" />
                  <span className="absolute -left-8 -top-3 size-2 rounded-full border border-white/[0.07] bg-white/[0.06]" />
                  <div className="max-w-full rounded-[18px] border border-white/[0.09] bg-[#202126]/90 px-4 py-2.5 text-sm leading-relaxed text-white/68 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.85)] backdrop-blur-sm [overflow-wrap:anywhere]">
                    {displayBio}
                  </div>
                </div>
              )}
            </div>
          </div>
          {!editable && (
            <div className="mb-2 flex items-center gap-2">
              {isFriend && onOpenChat && (
                <Button className="border border-accent/25 bg-accent/15 text-white hover:bg-accent/25" size="sm" onPress={() => onOpenChat(user.id)}>
                  <IconMessage className="size-4" />
                  {t('friends.message')}
                </Button>
              )}
              {isFriend && onRemoveFriend && (
                <Button className="border border-red-400/20 bg-red-500/10 text-red-100 hover:bg-red-500/18" size="sm" onPress={() => onRemoveFriend(user.id)}>
                  <IconUserMinus className="size-4" />
                  {t('friends.removeFriend')}
                </Button>
              )}
              {!isFriend && onAddFriend && (
                <Button className="border border-accent/25 bg-accent/15 text-white hover:bg-accent/25" size="sm" onPress={() => onAddFriend(user.username)}>
                  <IconUserPlus className="size-4" />
                  {t('friends.addFriend')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-8 px-8 pb-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section>
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.26em] text-white/28">{t('friends.playedInstances')}</p>
            <div className="overflow-hidden rounded-2xl bg-white/[0.035]">
              {instances.length === 0 ? (
                <div className="p-5 text-sm text-white/35">{t('friends.noPlayedInstances')}</div>
              ) : instances.map((instance) => {
                const background = playedInstanceBackground(instance)
                return (
                <div
                  key={instance.name}
                  className="grid grid-cols-[170px_minmax(0,1fr)] border-b border-white/[0.04] bg-[#121214] last:border-b-0"
                >
                  <div
                    className="h-24 border-r border-white/[0.04] bg-[#07080b] bg-cover bg-center"
                    style={background ? { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.24), rgba(0,0,0,.08)), url(${background})` } : undefined}
                  />
                  <div className="flex min-w-0 flex-col justify-center px-5">
                    <p className="truncate text-base font-black">{instance.name}</p>
                    <p className="mt-1 text-xs text-white/35">
                      {presence.kind === 'playing' && presence.text === instance.name
                        ? t('friends.playing')
                        : instance.minecraftVersion || instance.loader
                          ? [instance.minecraftVersion, instance.loader].filter(Boolean).join(' · ')
                          : t('friends.sharedInstance')}
                    </p>
                  </div>
                </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl bg-white/[0.035] p-5">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.26em] text-white/28">{t('friends.linkedAccounts')}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { label: 'Discord', icon: <DiscordIcon size={18} /> },
                { label: 'Google', icon: <IconBrandGoogleFilled className="size-5" /> },
              ].map((provider) => (
                <div key={provider.label} className="flex items-center gap-3 rounded-xl bg-black/20 p-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-white/8 text-white/75">{provider.icon}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{provider.label}</p>
                    <p className="text-xs text-white/35">{t('friends.comingSoon')}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl bg-white/[0.035] p-5">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.26em] text-white/28">{t('friends.friends')} ({profileFriends.length})</p>
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {profileFriends.slice(0, 18).map((item) => (
                <button key={item.id} type="button" onClick={() => onOpenProfile?.(item)} className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-white/[0.05]">
                  <Avatar avatar={item.avatar} username={item.username} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black">{item.username}</p>
                    <p className="truncate text-xs text-white/35"><FriendStatus friend={item} /></p>
                  </div>
                </button>
              ))}
              {profileFriends.length === 0 && (
                <p className="py-2 text-sm text-white/35">{t('friends.empty')}</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-white/[0.035] p-5">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.26em] text-white/28">{t('friends.socialLinks')}</p>
            <div className="space-y-2">
              {networkRows.map((row) => (
                <div key={row.key} className="rounded-xl bg-black/20 p-3">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-sm font-bold">{row.label}</p>
                    {row.value && !editing && row.value.startsWith('http') && (
                      <button type="button" onClick={() => window.open(row.value, '_blank')} className="text-white/35 hover:text-white">
                        <IconExternalLink className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-white/35">{row.value || t('friends.notLinked')}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-[24px] border border-white/10 bg-[#121316] shadow-[0_28px_90px_-42px_rgba(0,0,0,0.95)]">
            <div className="relative overflow-hidden border-b border-white/[0.06] px-6 py-4">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,color-mix(in_srgb,var(--color-accent)_18%,transparent),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.055),transparent_46%)]" />
              <div className="relative flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/30">{t('friends.editProfile')}</p>
                  <h3 className="mt-0.5 text-xl font-black tracking-tight">{draftMeta.username.trim() || user.username}</h3>
                </div>
                <button type="button" onClick={() => setEditing(false)} className="grid size-9 place-items-center rounded-xl text-white/35 transition-colors hover:bg-white/10 hover:text-white">
                  <IconX className="size-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[250px_minmax(0,1fr)]">
              <div className="space-y-2.5">
                <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035]">
                  <div className="relative h-24 bg-[#07080b]">
                    <SocialBannerImage urls={displayBannerUrls} />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/55" />
                    <div className="absolute -bottom-7 left-4">
                      <Avatar avatar={user.avatar} username={draftMeta.username || user.username} size={56} />
                    </div>
                  </div>
                  <div className="px-4 pb-4 pt-9">
                    <p className="truncate text-base font-black">{draftMeta.username.trim() || user.username}</p>
                    <p className="mt-0.5 line-clamp-2 min-h-10 text-sm leading-5 text-white/45">
                      {draftMeta.bio.trim() || t('friends.profileBioPlaceholder')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => avatarFileRef.current?.click()} className="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.045] px-2 text-xs font-bold text-white/62 transition-colors hover:bg-white/[0.08] hover:text-white">
                    <IconUpload className="size-4" />
                    <span className="truncate">{t('friends.changePhoto')}</span>
                  </button>
                  <button type="button" onClick={() => bannerFileRef.current?.click()} className="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.045] px-2 text-xs font-bold text-white/62 transition-colors hover:bg-white/[0.08] hover:text-white">
                    <IconUpload className="size-4" />
                    <span className="truncate">{t('friends.changeBanner')}</span>
                  </button>
                </div>
              </div>

              <div className="min-w-0 space-y-4">
                <div className="space-y-2.5">
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-white/30">{t('friends.profileName')}</span>
                    <input
                      value={draftMeta.username}
                      maxLength={PROFILE_USERNAME_MAX_LENGTH}
                      onChange={(event) => {
                        const username = event.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, PROFILE_USERNAME_MAX_LENGTH)
                        setDraftMeta((prev) => ({ ...prev, username }))
                      }}
                      className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.045] px-4 text-base font-black text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/45 focus:bg-white/[0.06]"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white/30">{t('friends.profileBio')}</span>
                      <span className={`text-[11px] font-bold ${draftMeta.bio.length >= PROFILE_BIO_MAX_LENGTH ? 'text-accent' : 'text-white/32'}`}>
                        {draftMeta.bio.length}/{PROFILE_BIO_MAX_LENGTH}
                      </span>
                    </div>
                    <textarea
                      value={draftMeta.bio}
                      maxLength={PROFILE_BIO_MAX_LENGTH}
                      onChange={(event) => setDraftMeta((prev) => ({ ...prev, bio: event.target.value.slice(0, PROFILE_BIO_MAX_LENGTH) }))}
                      placeholder={t('friends.profileBioPlaceholder')}
                      className="h-24 w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.045] px-4 py-3 text-sm leading-relaxed text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/45 focus:bg-white/[0.06] [overflow-wrap:anywhere]"
                    />
                  </label>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-white/30">{t('friends.socialLinks')}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {networkRows.map((row) => (
                      <input
                        key={row.key}
                        value={links[row.key]}
                        onChange={(event) => updateLink(row.key, event.target.value)}
                        placeholder={`https://${row.label.toLowerCase().replace(/\s.+$/, '')}.com/...`}
                        className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.045] px-4 text-sm text-white outline-none transition-colors placeholder:text-white/24 focus:border-accent/45 focus:bg-white/[0.06]"
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-white/30">{t('friends.linkedAccounts')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: 'Discord', icon: <DiscordIcon size={18} /> },
                      { label: 'Google', icon: <IconBrandGoogleFilled className="size-5" /> },
                    ].map((provider) => (
                      <div key={provider.label} className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.04] p-2.5 text-left opacity-80">
                        <div className="grid size-9 place-items-center rounded-lg bg-white/8 text-white/75">{provider.icon}</div>
                        <div>
                          <p className="text-sm font-black">{provider.label}</p>
                          <p className="text-xs text-white/35">{t('friends.comingSoon')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-white/[0.06] px-5 py-4">
              <Button variant="tertiary" className="bg-white/[0.045] text-white/60 hover:bg-white/[0.08] hover:text-white" onPress={() => { setLinks(loadProfileLinks()); setDraftMeta(profileMeta); setEditing(false) }}>
                <IconX className="size-4" />
                {t('friends.cancel')}
              </Button>
              <Button className="bg-accent text-accent-foreground disabled:opacity-45" isDisabled={!PROFILE_USERNAME_PATTERN.test(draftMeta.username.trim())} onPress={saveLinks}>
                <IconCheck className="size-4" />
                {t('friends.saveChanges')}
              </Button>
            </div>
          </div>
        </div>
      )}
      {achievementsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0d0e12] shadow-[0_30px_110px_-55px_rgba(0,0,0,0.95)]">
            <div className="relative overflow-hidden border-b border-white/[0.06] px-6 py-6">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,color-mix(in_srgb,var(--color-accent)_22%,transparent),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_45%)]" />
              <div className="relative flex items-start justify-between gap-5">
                <div className="flex items-center gap-4">
                  <div className="grid size-14 place-items-center rounded-2xl border border-accent/25 bg-accent/15 text-accent shadow-[0_16px_45px_-28px_color-mix(in_srgb,var(--color-accent)_65%,transparent)]">
                    <IconTrophy className="size-7" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black tracking-tight">{t('friends.achievements')}</h3>
                    <p className="mt-1 text-sm text-white/42">{unlockedAchievements}/{achievements.length} {t('friends.achievementUnlocked')}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setAchievementsOpen(false)} className="grid size-9 place-items-center rounded-xl text-white/35 transition-colors hover:bg-white/10 hover:text-white">
                  <IconX className="size-4" />
                </button>
              </div>
              <div className="relative mt-6 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-accent shadow-[0_0_28px_color-mix(in_srgb,var(--color-accent)_55%,transparent)] transition-all"
                  style={{ width: `${Math.round((unlockedAchievements / Math.max(achievements.length, 1)) * 100)}%` }}
                />
              </div>
            </div>
            <div className="grid max-h-[62vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              {achievements.map((achievement) => (
                <div
                  key={achievement.id}
                  className={[
                    'group relative overflow-hidden rounded-2xl border p-4 transition-all hover:-translate-y-0.5',
                    achievement.unlocked
                      ? 'border-accent/35 bg-accent/10 shadow-[0_18px_50px_-36px_color-mix(in_srgb,var(--color-accent)_65%,transparent)]'
                      : 'border-white/[0.07] bg-[#121214] opacity-75 hover:opacity-100',
                  ].join(' ')}
                >
                  <div className={['absolute inset-x-0 top-0 h-px', achievement.unlocked ? 'bg-accent/55' : 'bg-white/[0.08]'].join(' ')} />
                  <div className="flex items-start gap-4">
                    <div className={['grid size-12 shrink-0 place-items-center rounded-2xl border', achievement.unlocked ? 'border-accent/25 bg-accent/18 text-accent' : 'border-white/[0.06] bg-white/[0.04] text-white/24'].join(' ')}>
                      <IconTrophy className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-white">{achievement.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-white/42">{achievement.description}</p>
                      <p className={['mt-3 text-[10px] font-black uppercase tracking-[0.22em]', achievement.unlocked ? 'text-accent' : 'text-white/25'].join(' ')}>
                        {achievement.unlocked ? t('friends.achievementUnlocked') : t('friends.achievementLocked')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {achievementToast && (
        <div className="fixed bottom-6 right-6 z-[60] w-[360px] max-w-[calc(100vw-48px)] animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="relative overflow-hidden rounded-2xl border border-accent/35 bg-[#11131a] shadow-[0_28px_80px_-34px_rgba(0,0,0,0.95)]">
            <div className="absolute inset-x-0 top-0 h-px bg-accent/75" />
            <div className="absolute -right-10 -top-14 size-36 rounded-full bg-accent/18 blur-2xl" />
            <div className="relative flex items-center gap-4 p-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent/18 text-accent shadow-[0_14px_42px_-26px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]">
                <IconTrophy className="size-7" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-accent">{t('friends.achievementUnlocked')}</p>
                <p className="mt-1 truncate text-base font-black text-white">{achievementToast.title}</p>
                <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-white/42">{achievementToast.description}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
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
    <div className="flex h-full min-h-0 min-w-0 flex-col">
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
        {messages.filter((message) => !isProfileSyncMessage(message.content)).length === 0 && <p className="text-white/40 text-sm">{t('friends.noMessages')}</p>}
        {messages.filter((message) => !isProfileSyncMessage(message.content)).map((m) => (
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
  message, mine, onEdit, onDelete, onReply, onReact, senderUsername, senderAvatar, onOpenProfile, canManage = true,
}: {
  message: ChatMessage
  mine: boolean
  onEdit: (newContent: string) => void
  onDelete: () => void
  onReply: () => void
  onReact: (emoji: string) => void
  senderUsername: string
  senderAvatar: string | null
  onOpenProfile?: () => void
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

  const actionButtons = !isEditing ? (
    <div className="flex gap-0.5 rounded-md border border-border bg-surface p-0.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
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
          className="size-6 flex items-center justify-center rounded text-white/35 hover:text-white/75 hover:bg-white/10 transition-colors"
        >
          <IconTrash className="size-3.5" />
        </button>
      )}
    </div>
  ) : null

return (
    <div className={`group flex max-w-[85%] min-w-0 items-start gap-2 ${mine ? 'self-end flex-row-reverse' : 'self-start'}`}>
      <button type="button" onClick={onOpenProfile} className="shrink-0 rounded-full transition-transform hover:scale-105">
        <Avatar avatar={senderAvatar} username={senderUsername} size={28} />
      </button>

      <div className={`relative flex flex-col min-w-0 ${mine ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-1.5 mb-1 ${mine ? 'flex-row-reverse' : ''}`}>
          <button type="button" onClick={onOpenProfile} className="text-xs font-semibold text-white/80 transition-colors hover:text-accent">{senderUsername}</button>
          <span className="text-[11px] text-white/35">
            {new Date(message.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!mine && actionButtons}
          {mine && actionButtons}
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
              {showReactions && (
                <div className="absolute right-0 top-full z-20 mt-1 flex gap-1 rounded-full border border-border bg-surface p-1 shadow-xl">
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

function ChatPanel({
  friend,
  onClose,
  onOpenProfile,
  global = false,
}: {
  friend?: ModstackFriend | null
  onClose: () => void
  onOpenProfile?: (user: SocialProfileTarget) => void
  global?: boolean
}) {
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
  const history = global ? globalMessages : friend ? (messages[friend.id] ?? []) : []
  const visibleHistory = history.filter((message) => !isProfileSyncMessage(message.content))
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
    } else if (friend && messages[friend.id] === undefined) {
      loadHistory(friend.id).catch(() => {})
    }
  }, [friend?.id, global, messages, loadHistory, loadGlobalHistory])

  useEffect(() => {
    if (!friend || global) return
    if (unread[friend.id]) markRead(friend.id)
  }, [friend?.id, global, unread, markRead])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [visibleHistory.length])

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
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex items-center gap-3 p-3 border-b border-white/10">
        <Button isIconOnly size="sm" variant="tertiary" aria-label="Volver" onPress={onClose}>
          <IconArrowLeft className="size-4" />
        </Button>
        {global ? (
          <div className="size-8 rounded-full bg-white/10 flex items-center justify-center text-white/70">
            <IconWorld className="size-4" />
          </div>
        ) : (
          <button type="button" onClick={() => friend && onOpenProfile?.(friend)} className="rounded-full transition-transform hover:scale-105">
            <Avatar avatar={friend?.avatar ?? null} username={friend?.username ?? ''} size={32} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <button
            type="button"
            disabled={global || !friend}
            onClick={() => friend && onOpenProfile?.(friend)}
            className="block max-w-full truncate text-left font-semibold leading-tight text-white transition-colors enabled:hover:text-accent disabled:cursor-default"
          >
            {global ? 'Modstack Chat' : friend?.username}
          </button>
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
        {!global && friend && messages[friend.id] === undefined && <p className="text-white/40 text-sm">{t('friends.loadingMessages')}</p>}
        {visibleHistory.length === 0 && <p className="text-white/40 text-sm">{t('friends.noMessages')}</p>}
        {visibleHistory.map((m) => {
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
              onOpenProfile={() => sender && onOpenProfile?.(sender)}
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
          <p className={`text-[11px] mb-1 text-right ${text.length >= 800 ? 'text-accent' : 'text-white/40'}`}>
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

export default function Friends() {
  const {
    account,
    connected,
    friends,
    messages,
    incoming,
    outgoing,
    unread,
    logout,
    sendFriendRequest,
    acceptRequest,
    deleteRequest,
    removeFriend,
    loadHistory,
    sendMessage,
  } = useModstack()
  const t = useLauncherTranslation()
  const { user: activeMinecraftUser } = useAuth()
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [openChats, setOpenChats] = useState<string[]>([])
  const [showAddFriends, setShowAddFriends] = useState(false)
  const [showGlobalChat, setShowGlobalChat] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [profileUser, setProfileUser] = useState<SocialProfileTarget | null>(null)
  const [socialTab, setSocialTab] = useState<SocialTab>('friends')
  const [friendSearch, setFriendSearch] = useState('')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [bannerOverride, setBannerOverride] = useState<string | null>(() => loadBannerOverride(account?.id))
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groups, setGroups] = useState<LocalChatGroup[]>(loadLocalGroups)
  const [groupMessages, setGroupMessages] = useState<Record<string, ChatMessage[]>>(loadGroupMessages)
  const [profileSyncTick, setProfileSyncTick] = useState(0)

  const displayAccount = account
  const activeFriend = friends.find((f) => f.id === activeChat) || null
  const activeGroup = groups.find((group) => group.id === activeGroupId) || null
  void connected

  useEffect(() => saveLocalGroups(groups), [groups])
  useEffect(() => saveGroupMessages(groupMessages), [groupMessages])
  useEffect(() => {
    setBannerOverride(loadBannerOverride(account?.id))
  }, [account?.id])

  useEffect(() => {
    if (!account?.id) return
    const handleActiveSkinChanged = () => {
      localStorage.removeItem(`${SOCIAL_PROFILE_SYNC_HASH_KEY}.${account.id}`)
      setProfileSyncTick((value) => value + 1)
    }
    window.addEventListener('modstack:active-skin-changed', handleActiveSkinChanged)
    return () => window.removeEventListener('modstack:active-skin-changed', handleActiveSkinChanged)
  }, [account?.id])

  useEffect(() => {
    if (!account || friends.length === 0) return
    const minecraftName = activeMinecraftUser?.minecraft?.name
    const meta = profileDraftFromUser(account)
    const ownsLocalMinecraft =
      sameProfileName(account.username, minecraftName) ||
      sameProfileName(account.displayName, minecraftName) ||
      sameProfileName(meta.username, minecraftName)
    if (!ownsLocalMinecraft) return

    let cancelled = false
    ;(async () => {
      const localInstances = await loadLocalInstances().catch(() => [])
      const played = await Promise.all(
        localInstances.map(async (instance: LocalInstance) => ({
          instance,
          playtime: await invoke<number>('get_instance_playtime', { instanceId: instance.id }).catch(() => 0),
        }))
      )
      if (cancelled) return
      const playedSorted = played
        .filter(({ playtime }) => playtime > 0)
        .sort((a, b) => (b.playtime - a.playtime) || (b.instance.created_at - a.instance.created_at))
      const playedInstances = await Promise.all(
        playedSorted
        .slice(0, 4)
        .map(async ({ instance, playtime }) => ({
          name: instance.title,
          loader: instance.loader,
          minecraftVersion: instance.minecraft_version,
          playtime,
          backgroundUrl: instance.background_path ? convertFileSrc(instance.background_path) : undefined,
          backgroundDataUrl: await makePortableBackground(instance.background_path),
        }))
      )

      saveProfilePlayedInstances(account.id, playedInstances)
      const profileSkin = await loadActiveProfileSkin()
      const friendIds = friends.map((friend) => friend.id).sort()
      const linkedProviders = loadLinkedProviders(account.id)
      const currentBanner = loadBannerOverride(account.id)
      const signature = JSON.stringify({
        version: PROFILE_SYNC_VERSION,
        meta,
        playedInstances,
        playedTotal: playedSorted.length,
        linkedProviders,
        bannerUrl: currentBanner,
        skin: profileSkin,
        friendIds,
      })
      const hashKey = `${SOCIAL_PROFILE_SYNC_HASH_KEY}.${account.id}`
      if (localStorage.getItem(hashKey) === signature) return
      localStorage.setItem(hashKey, signature)
      const message = createProfileSyncMessage(meta, playedInstances, playedSorted.length, linkedProviders, currentBanner, profileSkin)
      for (const friend of friends) sendMessage(friend.id, message)
    })()

    return () => {
      cancelled = true
    }
  }, [account?.id, account?.username, account?.displayName, activeMinecraftUser?.minecraft?.name, bannerOverride, profileSyncTick, friends, sendMessage])

  const openChat = useCallback((id: string) => {
    setActiveChat(id)
    setShowAddFriends(false)
    setShowGlobalChat(false)
    setShowGroups(false)
    setProfileUser(null)
    setActiveGroupId(null)
    setSocialTab('messages')
    setOpenChats((prev) => prev.includes(id) ? prev : [...prev, id])
  }, [])

  const openProfile = useCallback((user: SocialProfileTarget) => {
    setProfileUser(user)
    setShowAddFriends(false)
    setShowGlobalChat(false)
    setShowGroups(false)
    setActiveGroupId(null)
    if (friends.some((friend) => friend.id === user.id)) {
      loadHistory(user.id).catch(() => {})
    }
  }, [friends, loadHistory])

  const broadcastProfileSync = useCallback((meta: SocialProfileMeta, playedInstances: PlayedProfileInstance[], playedTotal = playedInstances.length, linkedProviders: LinkedProviders = {}, bannerUrl?: string | null) => {
    if (!account) return
    loadActiveProfileSkin().then((profileSkin) => {
      const message = createProfileSyncMessage(meta, playedInstances, playedTotal, linkedProviders, bannerUrl ?? loadBannerOverride(account.id), profileSkin)
      for (const friend of friends) {
        sendMessage(friend.id, message)
      }
    })
  }, [account, friends, sendMessage])

  const updateBannerOverride = (value: string | null) => {
    if (!account) return
    saveBannerOverride(account.id, value)
    setBannerOverride(value)
  }

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
    setProfileUser(null)
    setActiveGroupId(null)
    setShowGlobalChat(true)
    setSocialTab('messages')
  }

  const openGroups = () => {
    setActiveChat(null)
    setShowAddFriends(false)
    setShowGlobalChat(false)
    setProfileUser(null)
    setActiveGroupId(null)
    setShowGroups(true)
    setSocialTab('messages')
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
  void openGroups
  void closeChat

  const openAddFriends = () => {
    setActiveChat(null)
    setProfileUser(null)
    setShowGlobalChat(false)
    setShowGroups(false)
    setActiveGroupId(null)
    setShowAddFriends(false)
    setSocialTab('requests')
  }

  const requestFriendship = async (username: string) => {
    await sendFriendRequest(username)
    toast(`${t('friends.requestSent')} ${username}`)
    openAddFriends()
  }

  const deleteFriendship = async (id: string) => {
    await removeFriend(id)
    toast(t('friends.removeFriend'))
    if (activeChat === id) setActiveChat(null)
  }

  let content: ReactNode

  if (!account) {
    content = <LoginScreen />
  } else if (profileUser) {
    const profileFriend = friends.find((friend) => friend.id === profileUser.id) ?? null
    const profileMessages = profileFriend ? (messages[profileFriend.id] ?? []) : []
    const profileTarget = profileUser.id === account.id && displayAccount ? displayAccount : profileUser
    content = (
      <SocialProfilePanel
        user={profileTarget}
        friend={profileFriend}
        messages={profileMessages}
        friends={friends}
        editable={profileUser.id === account.id}
        bannerOverride={profileUser.id === account.id ? bannerOverride : null}
        onBannerChange={updateBannerOverride}
        onBack={() => setProfileUser(null)}
        onOpenChat={openChat}
        onOpenProfile={openProfile}
        onAddFriend={(username) => requestFriendship(username).catch((error) => toast.danger(t('friends.sendFailed'), { description: String(error) }))}
        onRemoveFriend={(id) => deleteFriendship(id).catch((error) => toast.danger(t('friends.removeFriend'), { description: String(error) }))}
        onProfileSync={broadcastProfileSync}
      />
    )
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
    content = <ChatPanel global onClose={() => setShowGlobalChat(false)} onOpenProfile={openProfile} />
  } else if (activeFriend) {
    content = <ChatPanel friend={activeFriend} onClose={() => setActiveChat(null)} onOpenProfile={openProfile} />
  } else if (showAddFriends) {
    content = (
      <AddFriendsPanel
        incoming={incoming}
        outgoing={outgoing}
        onAccept={(id) => acceptRequest(id).catch(() => {})}
        onDecline={(id) => deleteRequest(id).catch(() => {})}
        onCancelRequest={(id) => deleteRequest(id).catch(() => {})}
        onSendRequest={async (name) => {
          await requestFriendship(name)
        }}
        onBack={() => setShowAddFriends(false)}
      />
    )
  } else if (showGroups) {
    content = <GroupsPanel groups={groups} friends={friends} onOpenGroup={(id) => { setActiveGroupId(id); setShowGroups(false) }} onCreateGroup={createGroup} onBack={() => setShowGroups(false)} />
  } else {
    const filteredFriends = friends.filter((friend) => friend.username.toLowerCase().includes(friendSearch.trim().toLowerCase()))
    const onlineFriends = filteredFriends.filter((friend) => parsePresence(friend.status, friend.activity).kind !== 'offline')
    const offlineFriends = filteredFriends.filter((friend) => parsePresence(friend.status, friend.activity).kind === 'offline')
    const recentOpenChats = (openChats.length ? openChats : friends.map((friend) => friend.id))
      .map((id) => friends.find((friend) => friend.id === id))
      .filter((friend): friend is ModstackFriend => Boolean(friend))

    content = (
      <div className="flex h-full min-h-0 flex-col px-10 pb-7">
        {socialTab === 'friends' && (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="rounded-3xl border border-white/[0.07] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_16%,transparent),rgba(255,255,255,0.035)_42%,rgba(255,255,255,0.018))] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
                <div className="flex items-center gap-4">
                  <div className="grid size-12 place-items-center rounded-2xl bg-accent/18 text-accent">
                    <IconUsers className="size-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-white/32">Modstack Social</p>
                    <h2 className="mt-1 truncate text-2xl font-black text-white">{friends.length} {t('friends.friends')}</h2>
                    <p className="mt-1 text-sm text-white/38">{onlineFriends.length} {t('friends.online')} · {offlineFriends.length} {t('friends.offline')}</p>
                  </div>
                </div>
                <div className="mt-5 flex gap-2">
                  <button type="button" onClick={() => setSocialTab('messages')} className="rounded-xl bg-white/[0.07] px-4 py-2 text-sm font-bold text-white/75 hover:bg-white/[0.11] hover:text-white">
                    {t('friends.tabMessages')}
                  </button>
                  <button type="button" onClick={openAddFriends} className="rounded-xl bg-accent/18 px-4 py-2 text-sm font-bold text-white hover:bg-accent/26">
                    {t('friends.addFriend')}
                  </button>
                </div>
              </div>
              <div className="rounded-3xl border border-white/[0.06] bg-white/[0.035] p-5">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-white/28">{t('friends.quickActions')}</p>
                <div className="mt-4 grid gap-2">
                  <button type="button" onClick={() => displayAccount && openProfile(displayAccount)} className="flex items-center gap-3 rounded-2xl bg-black/20 p-3 text-left hover:bg-white/[0.06]">
                    <Avatar avatar={displayAccount?.avatar ?? null} username={displayAccount?.username ?? ''} size={36} />
                    <div>
                      <p className="text-sm font-black">{t('friends.profile')}</p>
                      <p className="text-xs text-white/35">{displayAccount?.username}</p>
                    </div>
                  </button>
                  <button type="button" onClick={() => setSocialTab('requests')} className="flex items-center gap-3 rounded-2xl bg-black/20 p-3 text-left hover:bg-white/[0.06]">
                    <div className="grid size-9 place-items-center rounded-xl bg-white/8 text-white/60"><IconUserPlus className="size-4" /></div>
                    <div>
                      <p className="text-sm font-black">{t('friends.tabRequests')}</p>
                      <p className="text-xs text-white/35">{incoming.length + outgoing.length} {t('friends.pending')}</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <div className="relative flex-1">
                <IconSearch className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/26" />
                <input
                  value={friendSearch}
                  onChange={(event) => setFriendSearch(event.target.value)}
                  placeholder={t('friends.filterFriends')}
                  className="h-11 w-full rounded-2xl border border-white/[0.06] bg-white/[0.035] pl-11 pr-4 text-sm text-white outline-none transition-colors placeholder:text-white/24 focus:border-accent/35 focus:bg-white/[0.055]"
                />
              </div>
            </div>

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
              {onlineFriends.length > 0 && (
                <section>
                  <p className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-white/30">
                    <span className="size-2 rounded-full bg-accent/70" />
                    {t('friends.online')} {onlineFriends.length}
                  </p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {onlineFriends.map((friend) => (
                      <button key={friend.id} type="button" onClick={() => openProfile(friend)} className="group flex items-center gap-3 rounded-xl bg-white/[0.035] p-3 text-left transition-colors hover:bg-white/[0.06]">
                        <Avatar avatar={friend.avatar} username={friend.username} size={38} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black">{friend.username}</p>
                          <p className="truncate text-xs text-white/35"><FriendStatus friend={friend} /></p>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation()
                            deleteFriendship(friend.id).catch((error) => toast.danger(t('friends.removeFriend'), { description: String(error) }))
                          }}
                          className="grid size-8 place-items-center rounded-lg text-white/24 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-200 group-hover:opacity-100"
                          aria-label={t('friends.removeFriend')}
                        >
                          <IconTrash className="size-4" />
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className={onlineFriends.length ? 'mt-7' : ''}>
                <p className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-white/30">
                  <span className="size-2 rounded-full bg-white/25" />
                  {t('friends.offline')} {offlineFriends.length}
                </p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {offlineFriends.map((friend) => (
                    <button key={friend.id} type="button" onClick={() => openProfile(friend)} className="group flex items-center gap-3 rounded-xl bg-white/[0.035] p-3 text-left transition-colors hover:bg-white/[0.06]">
                      <Avatar avatar={friend.avatar} username={friend.username} size={38} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black">{friend.username}</p>
                        <p className="truncate text-xs text-white/35"><FriendStatus friend={friend} /></p>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation()
                          deleteFriendship(friend.id).catch((error) => toast.danger(t('friends.removeFriend'), { description: String(error) }))
                        }}
                        className="grid size-8 place-items-center rounded-lg text-white/24 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-200 group-hover:opacity-100"
                        aria-label={t('friends.removeFriend')}
                      >
                        <IconTrash className="size-4" />
                      </span>
                    </button>
                  ))}
                </div>
                {filteredFriends.length === 0 && (
                  <p className="mt-10 text-center text-sm text-white/35">{t('friends.empty')}</p>
                )}
              </section>
            </div>
          </>
        )}

        {socialTab === 'messages' && (
          <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-r border-white/[0.06] pr-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-black">{t('friends.message')}</h2>
                <button type="button" onClick={openAddFriends} className="grid size-8 place-items-center rounded-lg text-white/35 hover:bg-white/[0.06] hover:text-white">
                  <IconUserPlus className="size-4" />
                </button>
              </div>
              <button type="button" onClick={openGlobalChat} className="mb-3 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.06]">
                <div className="grid size-8 place-items-center rounded-full bg-white/10"><IconWorld className="size-4" /></div>
                <span className="font-bold">{t('friends.globalChatLabel')}</span>
              </button>
              {recentOpenChats.map((friend) => (
                <button key={friend.id} type="button" onClick={() => openChat(friend.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.06]">
                  <Avatar avatar={friend.avatar} username={friend.username} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black">{friend.username}</p>
                    <p className="truncate text-xs text-white/30"><FriendStatus friend={friend} /></p>
                  </div>
                  {unread[friend.id] ? <span className="size-2 rounded-full bg-accent" /> : null}
                </button>
              ))}
            </aside>
            <div className="flex items-center justify-center text-sm text-white/30">
              {t('friends.select')}
            </div>
          </div>
        )}

        {socialTab === 'requests' && (
          <AddFriendsPanel
            incoming={incoming}
            outgoing={outgoing}
            onAccept={(id) => acceptRequest(id).catch(() => {})}
            onDecline={(id) => deleteRequest(id).catch(() => {})}
            onCancelRequest={(id) => deleteRequest(id).catch(() => {})}
            onSendRequest={async (name) => {
              await requestFriendship(name)
            }}
            onBack={() => setSocialTab('friends')}
          />
        )}

      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--color-page-background)] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),transparent_30%)]" />
        <div className="relative h-full min-h-0 bg-[var(--color-page-background)]">
          <div className="flex h-full min-h-0 w-full flex-col">
          {account && !profileUser && (
            <header className="shrink-0 px-10 pb-5 pt-6">
              <div className="relative flex items-center gap-5">
                <div className="w-52 shrink-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.34em] text-accent/70">Modstack</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight">Social</h1>
                </div>
                <nav className="absolute left-1/2 grid w-[min(760px,54vw)] -translate-x-1/2 grid-cols-3 gap-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-1.5 text-sm">
                  {[
                    { id: 'friends' as const, label: t('friends.tabFriends'), icon: IconUsers },
                    { id: 'messages' as const, label: t('friends.tabMessages'), icon: IconMessage },
                    { id: 'requests' as const, label: t('friends.tabRequests'), icon: IconUserPlus },
                  ].map((item) => {
                    const Icon = item.icon
                    const selected = socialTab === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setSocialTab(item.id)
                          setShowAddFriends(false)
                          setShowGlobalChat(false)
                          setShowGroups(false)
                          setActiveChat(null)
                          setActiveGroupId(null)
                        }}
                        className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 transition-all ${selected ? 'bg-accent/18 text-white shadow-[0_14px_34px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] ring-1 ring-accent/20' : 'text-white/38 hover:bg-white/[0.04] hover:text-white/70'}`}
                      >
                        <Icon className="size-4" />
                        <span className="truncate font-semibold">{item.label}</span>
                      </button>
                    )
                  })}
                </nav>
                <div className="relative ml-auto shrink-0">
                  <button type="button" onClick={() => setAccountMenuOpen((value) => !value)} className="rounded-full transition-transform hover:scale-105">
                    <Avatar avatar={displayAccount?.avatar ?? null} username={displayAccount?.username ?? ''} size={38} />
                  </button>
                  {accountMenuOpen && (
                    <div className="absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101116] p-1.5 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          displayAccount && openProfile(displayAccount)
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.07] hover:text-white"
                      >
                        <IconUsers className="size-4 text-accent" />
                        {t('friends.viewProfile')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false)
                          logout()
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/70 transition-colors hover:bg-red-500/10 hover:text-red-200"
                      >
                        <IconLogout className="size-4 text-red-300" />
                        {t('friends.logout')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </header>
          )}
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {content}
          </main>
          </div>
        </div>
    </div>
  )
}
