import { invoke } from '@tauri-apps/api/core'

export type LocalInstance = {
  id: string
  title: string
  minecraft_version: string
  loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  icon_path?: string | null
  background_path?: string | null
  created_at: number
}

export const loadLocalInstances = () =>
  invoke<LocalInstance[]>('load_local_instances')

export const updateLocalInstance = (
  id: string,
  title: string,
  minecraftVersion: string,
  loader: string,
  iconSrc?: string | null,
  backgroundSrc?: string | null,
  clearIcon?: boolean,
  clearBackground?: boolean,
) =>
  invoke<LocalInstance>('update_local_instance', {
    id,
    title,
    minecraftVersion,
    loader,
    iconSrc: iconSrc ?? null,
    backgroundSrc: backgroundSrc ?? null,
    clearIcon: clearIcon ?? false,
    clearBackground: clearBackground ?? false,
  })

export const deleteLocalInstance = (id: string) =>
  invoke<void>('remove_local_instance', { id })

let _selectedId: string | null = null
export const getSelectedId = () => _selectedId
export const setSelectedId = (id: string | null) => { _selectedId = id }

export function slugify(s: string) {
  return s.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}