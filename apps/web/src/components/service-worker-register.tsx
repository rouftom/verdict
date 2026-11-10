'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@verdict/ui'
import { activateUpdate, registerServiceWorker } from '@/lib/sw-registration'

/** Registers the service worker and offers a refresh when a new build is ready. */
export function ServiceWorkerRegister() {
  const { t } = useTranslation()
  const [waiting, setWaiting] = React.useState<ServiceWorker | null>(null)
  const [dismissed, setDismissed] = React.useState(false)

  React.useEffect(() => {
    registerServiceWorker((worker) => {
      setWaiting(worker)
      setDismissed(false)
    })
  }, [])

  if (!waiting || dismissed) return null

  return (
    <div
      role="status"
      className="fixed right-3 top-14 z-40 flex items-center gap-2 border border-border bg-card px-2.5 py-2 text-[11px] text-card-foreground shadow-lg"
    >
      <RefreshCw className="h-3.5 w-3.5 text-brand-primary" />
      <span>{t('sw.ready')}</span>
      <Button type="button" size="sm" variant="primary" className="h-6 px-2 text-[11px]" onClick={() => activateUpdate(waiting)}>
        {t('sw.refresh')}
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={t('sw.dismiss')}
        onClick={() => setDismissed(true)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
