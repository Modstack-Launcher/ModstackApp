import { create } from 'zustand'

interface FriendsPanelState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useFriendsPanel = create<FriendsPanelState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}))