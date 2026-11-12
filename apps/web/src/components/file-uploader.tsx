'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, FileArchive, FileUp, Loader2, Upload, X } from 'lucide-react'
import { Badge, Button, Label, Progress, cn } from '@verdict/ui'

/**
 * Full-width archive picker, adapted from the organisation file uploader.
 * The parent owns the upload call so this component stays modality-neutral;
 * it keeps the same state machine: idle, dragging, uploading, error, done.
 */
export interface FileUploaderProps {
  id: string
  label: string
  hint: string
  accept: string
  maxBytes?: number
  disabled?: boolean
  /** Name of the uploaded archive, owned by the parent. */
  filename?: string
  /** Short summary under the name once uploaded. */
  detail?: string
  error?: string | null
  /** Extra control rendered at the flex end of the header, e.g. a model picker. */
  aside?: React.ReactNode
  onFile: (file: File, hooks: { onProgress: (percent: number) => void }) => Promise<void>
  onClear?: () => void
}

export function FileUploader({
  id,
  label,
  hint,
  accept,
  maxBytes = 2 * 1024 * 1024 * 1024,
  disabled = false,
  filename,
  detail,
  error,
  aside,
  onFile,
  onClear,
}: FileUploaderProps) {
  const { t } = useTranslation()
  const input = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const [internalError, setInternalError] = React.useState<string | null>(null)

  const upload = async (file: File) => {
    if (file.size > maxBytes) {
      setInternalError(t('offline.tooLarge', { size: Math.round(maxBytes / 1024 / 1024) }))
      return
    }
    setUploading(true)
    setProgress(0)
    setInternalError(null)
    try {
      await onFile(file, { onProgress: setProgress })
    } catch (cause) {
      setInternalError(cause instanceof Error ? cause.message : t('offline.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const readInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void upload(file)
  }

  const clear = () => {
    setInternalError(null)
    setProgress(0)
    onClear?.()
  }

  const shownError = error ?? internalError
  const done = Boolean(filename) && !uploading && !shownError
  const busy = uploading || disabled

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-7 flex-wrap items-center gap-2">
        <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold">
          <FileArchive className="h-3.5 w-3.5 text-brand-primary" />
          {label}
        </Label>
        <span className="text-[10px] text-muted-foreground">{t('offline.optional')}</span>
        {aside ? <div className="ml-auto flex items-center gap-2">{aside}</div> : null}
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (busy) return
          const file = event.dataTransfer.files?.[0]
          if (file) void upload(file)
        }}
        aria-busy={uploading}
        className={cn(
          'relative flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-2.5 transition-colors',
          dragging && !busy && 'border-brand-primary bg-brand-primary/5',
          shownError && 'border-destructive/50 bg-destructive/5',
        )}
      >
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            uploading
              ? 'bg-brand-primary text-white'
              : done
                ? 'bg-emerald-500/90 text-white'
                : shownError
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-muted text-muted-foreground',
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : done ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : shownError ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <FileUp className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? t('offline.uploading', { percent: progress }) : filename ? t('offline.replace') : t('offline.chooseZip')}
            </Button>
            <input
              ref={input}
              id={id}
              type="file"
              accept={accept}
              className="sr-only"
              onChange={readInput}
              disabled={disabled}
            />
            {filename ? (
              <Badge tone={done ? 'success' : 'brand'} className="max-w-[22rem] truncate">
                <FileArchive className="h-3 w-3 shrink-0" /> {filename}
              </Badge>
            ) : (
              <span className="text-[11px] text-muted-foreground">{t('offline.dropOrChoose')}</span>
            )}
            {detail ? <span className="text-[11px] tabular-nums text-muted-foreground">{detail}</span> : null}
          </div>
          <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{hint}</p>
          {uploading ? <Progress value={progress} label={t('offline.progress', { percent: progress })} className="mt-1.5" /> : null}
        </div>

        {filename || shownError ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('offline.clear')}
            onClick={clear}
            disabled={uploading}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      {shownError ? (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {shownError}
        </p>
      ) : null}
    </div>
  )
}
