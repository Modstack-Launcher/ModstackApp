import {
  ContextType,
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback
} from 'react'
import { invoke } from '@tauri-apps/api/core'

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null

function parseStoredJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) as T
  } catch {
    localStorage.removeItem(key)
    return fallback
  }
}

function normalizeUser(value: unknown): User | null {
  if (!isRecord(value) || !isRecord(value.minecraft)) return null

  const type = value.type === 'microsoft' ? 'microsoft' : value.type === 'offline' ? 'offline' : null
  const name = typeof value.minecraft.name === 'string' ? value.minecraft.name.trim() : ''
  const uuid = typeof value.minecraft.uuid === 'string' ? value.minecraft.uuid.trim() : ''

  if (!type || !name || !uuid) return null

  return {
    ...value,
    type,
    minecraft: {
      ...value.minecraft,
      name,
      uuid,
      access_token:
        typeof value.minecraft.access_token === 'string'
          ? value.minecraft.access_token
          : type === 'offline'
          ? 'none'
          : '',
      refresh_token:
        typeof value.minecraft.refresh_token === 'string' ? value.minecraft.refresh_token : '',
      ms_access_token:
        typeof value.minecraft.ms_access_token === 'string' ? value.minecraft.ms_access_token : '',
    },
  } as User
}

function readStoredUsers(): User[] {
  const stored = parseStoredJson<unknown[]>('userList', [])
  if (!Array.isArray(stored)) return []

  const seen = new Set<string>()
  const users: User[] = []

  for (const entry of stored) {
    const user = normalizeUser(entry)
    if (!user) continue
    const key = userKey(user)
    if (seen.has(key)) continue
    seen.add(key)
    users.push(user)
  }

  if (users.length !== stored.length) {
    localStorage.setItem('userList', JSON.stringify(users))
  }

  return users
}

export const userKey = (u: User) => `${u.type}:${u.minecraft.uuid}`

const AuthContext = createContext({
  authReady: false,
  user: null as User | null,
  loginWithMicrosoft: () => Promise.resolve(null as any),
  loginWithMojang: (_username: string) => Promise.resolve(null as any),
  isWaiting: false,
  userList: [] as User[],
  selectUser: (_user: User) => {},
  removeUser: (_user: User) => {},
  logout: () => {},
  updateUser: (_user: User) => {},
  refreshMicrosoftToken: () => Promise.resolve(null as string | null),
})

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isWaiting, setIsWaiting] = useState(false)
  const [userList, setUserList] = useState<User[]>([])

  const loginWithMicrosoft = async () => {
    setIsWaiting(true)
    try {
      const result = normalizeUser(await invoke("login_microsoft"))
      if (!result) throw new Error('Microsoft login did not return a valid Minecraft profile')
      setUser(result)
      return result
    } catch (e) {
      console.error(e)
      throw e
    } finally {
      setIsWaiting(false)
    }
  }

  const loginWithMojang = async (username: string) => {
    if (!username) return
    setIsWaiting(true)
    try {
      const result: any = await invoke('login_offline', { username })
      const user = normalizeUser(result)
      if (!user) throw new Error('Offline login did not return a valid profile')
      setUser(user)
      return user
    } finally {
      setIsWaiting(false)
    }
  }

  const init = () => {
    const storedUser = normalizeUser(parseStoredJson('userAuth', null))
    const storedListOfUsers = readStoredUsers()
    setUserList(storedListOfUsers)
    if (storedUser) setUser(storedUser)
    else localStorage.removeItem('userAuth')
    setAuthReady(true)
  }

  useEffect(() => {
    init()
  }, [])

  const onSetUser = (user: User) => {
    localStorage.setItem('userAuth', JSON.stringify(user))
    const storedListOfUsers = readStoredUsers()
    const key = userKey(user)
    const newList = storedListOfUsers.filter(u => userKey(u) !== key)
    newList.push(user)
    setUserList(newList)
    localStorage.setItem('userList', JSON.stringify(newList))
  }

  useEffect(() => {
    if (user) onSetUser(user)
  }, [user])

  const selectUser = (user: User) => setUser(user)

  const removeUser = useCallback((target: User) => {
    const key = userKey(target)
    const updated = readStoredUsers()
    const newList = updated.filter(u => userKey(u) !== key)
    localStorage.setItem('userList', JSON.stringify(newList))
    setUserList(newList)
    setUser((prev) => {
      if (!prev || userKey(prev) !== key) return prev
      const next = newList[0] ?? null
      if (next) {
        localStorage.setItem('userAuth', JSON.stringify(next))
      } else {
        localStorage.removeItem('userAuth')
      }
      return next
    })
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem("userAuth")
  }, [])

  const updateUser = useCallback((updated: User) => {
    setUser(updated)
  }, [])

  const refreshMicrosoftToken = useCallback(async (): Promise<string | null> => {
    if (!user || user.type !== 'microsoft') return null

    const refreshToken = (user as any)?.minecraft?.refresh_token
    if (!refreshToken) return null

    try {
      const result = await invoke<{ access_token: string; refresh_token: string; ms_access_token: string }>(
        "refresh_microsoft_token",
        { refreshToken }
      )

      const updatedUser: User = {
        ...user,
        minecraft: {
          ...user.minecraft,
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          ms_access_token: result.ms_access_token,
        }
      }

      setUser(updatedUser)
      return result.ms_access_token
    } catch (e) {
      console.error("Error refrescando token:", e)
      return null
    }
  }, [user])

  return (
    <AuthContext.Provider value={{
      authReady,
      user,
      loginWithMicrosoft,
      loginWithMojang,
      isWaiting,
      userList,
      selectUser,
      removeUser,
      logout,
      updateUser,
      refreshMicrosoftToken,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): ContextType<typeof AuthContext> {
  return useContext(AuthContext)
}
