type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

/**
 * Dev: never keep a service worker. A cached worker serves stale bundles and
 * hides code changes, so unregister any worker and drop its caches instead.
 */
export async function unregisterServiceWorkersInDev(): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return true
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    }
  } catch {
    /* best effort */
  }
  return true
}

export function registerServiceWorker(onUpdateReady?: (worker: ServiceWorker) => void) {
  if (process.env.NODE_ENV !== 'production') {
    void unregisterServiceWorkersInDev()
    return
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          // A new worker finished installing while an old one still controls
          // the page: surface it so the app can show a themed prompt instead
          // of a blocking `confirm()`.
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateReady?.(registration.waiting ?? newWorker)
          }
        })
      })

      setInterval(() => {
        void registration.update()
      }, 60 * 60 * 1000)
    } catch (error) {
      console.error('Service worker registration failed', error)
    }
  }

  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', register, { once: true })
}

export function activateUpdate(worker: ServiceWorker) {
  if (typeof window === 'undefined') return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  worker.postMessage({ type: 'SKIP_WAITING' })
}

export function setupInstallPrompt() {
  if (typeof window === 'undefined') return

  let deferredPrompt: BeforeInstallPromptEvent | null = null

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    ;(window as Window & { deferredPrompt?: BeforeInstallPromptEvent }).deferredPrompt = deferredPrompt
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
  })
}
