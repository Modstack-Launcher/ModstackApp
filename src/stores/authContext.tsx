import {
  ContextType,
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback
} from 'react'
import { invoke } from '@tauri-apps/api/core'

export const userKey = (u: User) => u.minecraft.uuid

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
      const result = await invoke("login_microsoft") as User
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
      setUser(result)
      return result
    } finally {
      setIsWaiting(false)
    }
  }

  const init = () => {
    const storedUser = JSON.parse(localStorage.getItem('userAuth') || 'null')
    const storedListOfUsers = JSON.parse(localStorage.getItem('userList') || '[]') as User[]
    setUserList(storedListOfUsers)
    if (storedUser) setUser(storedUser)
    setAuthReady(true)
  }

  useEffect(() => {
    init()
  }, [])

  const onSetUser = (user: User) => {
    localStorage.setItem('userAuth', JSON.stringify(user))
    const storedListOfUsers = JSON.parse(localStorage.getItem('userList') || '[]') as User[]
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
    const updated = JSON.parse(localStorage.getItem('userList') || '[]') as User[]
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