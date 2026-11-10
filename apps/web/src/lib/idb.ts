/**
 * Browser persistence without a server database: run snapshots and the last
 * workspace configuration live in IndexedDB. Everything is best-effort, so a
 * private-mode browser simply behaves as if nothing was stored.
 */

const DB_NAME = 'verdict'
const DB_VERSION = 1
const RUNS = 'runs'
const SETTINGS = 'settings'

export interface StoredRun {
  id: string
  createdAt: string
  status: string
  savedAt: string
  summary: {
    projects: number
    rubric: string
    tracks: number
  }
  snapshot: unknown
}

export interface StoredSettings {
  key: 'workspace'
  value: unknown
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function transaction<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(store, mode)
    const request = run(tx.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

export async function saveRun(entry: StoredRun): Promise<void> {
  const db = await open()
  if (!db) return
  await transaction(db, RUNS, 'readwrite', (store) => store.put(entry))
  db.close()
}

export async function listRuns(): Promise<StoredRun[]> {
  const db = await open()
  if (!db) return []
  const result = await transaction<StoredRun[]>(db, RUNS, 'readonly', (store) => store.getAll() as IDBRequest<StoredRun[]>)
  db.close()
  return (result ?? []).sort((left, right) => right.savedAt.localeCompare(left.savedAt)).slice(0, 25)
}

export async function deleteRun(id: string): Promise<void> {
  const db = await open()
  if (!db) return
  await transaction(db, RUNS, 'readwrite', (store) => store.delete(id))
  db.close()
}

export async function saveSettings(value: unknown): Promise<void> {
  const db = await open()
  if (!db) return
  await transaction(db, SETTINGS, 'readwrite', (store) => store.put({ key: 'workspace', value }))
  db.close()
}

export async function loadSettings<T>(): Promise<T | null> {
  const db = await open()
  if (!db) return null
  const result = await transaction<StoredSettings>(db, SETTINGS, 'readonly', (store) => store.get('workspace') as IDBRequest<StoredSettings>)
  db.close()
  return (result?.value as T) ?? null
}
