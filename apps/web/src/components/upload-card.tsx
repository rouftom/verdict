'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Upload, X } from 'lucide-react'
import { Badge, Button, Label, cn } from '@verdict/ui'

export interface UploadCardProps {
  id: string
  label: string
  hint: string
  accept: string
  filename?: string
  text: string
  required?: boolean
  /** A run is starting or live: the picker must not change the inputs. */
  disabled?: boolean
  /** Extra controls aligned to the end of the picker row (rubric mode, presets). */
  actions?: React.ReactNode
  onFile: (filename: string, text: string) => void
  onClear: () => void
}

export function UploadCard({
  id,
  label,
  hint,
  accept,
  filename,
  text,
  required = false,
  disabled = false,
  actions,
  onFile,
  onClear,
}: UploadCardProps) {
  const { t } = useTranslation()
  const input = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const [reading, setReading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const read = async (file: File) => {
    if (disabled) return
    if (file.size > 8 * 1024 * 1024) {
      setError(t('upload.tooLarge'))
      return
    }
    setReading(true)
    setError(null)
    try {
      onFile(file.name, await file.text())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('upload.unreadable'))
    } finally {
      setReading(false)
    }
  }

  const lines = text.trim() ? text.trim().split(/\r?\n/).length : 0
  const chars = text.length

  return (
    <div className="flex h-full min-w-0 flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-semibold">
          {label}
          {required ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
        {text ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('upload.clear', { label })}
            onClick={onClear}
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (disabled) return
          const file = event.dataTransfer.files?.[0]
          if (file) void read(file)
        }}
        aria-disabled={disabled}
        className={cn(
          'relative flex flex-1 flex-col rounded-lg border border-dashed border-border bg-muted/20 p-2.5 transition-colors',
          dragging && !disabled && 'border-brand-primary bg-brand-primary/5',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={reading || disabled}
          >
            <Upload className="h-3.5 w-3.5" />
            {reading ? t('upload.reading') : t('upload.chooseFile')}
          </Button>
          <input
            ref={input}
            id={id}
            type="file"
            accept={accept}
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void read(file)
              event.target.value = ''
            }}
          />
          {filename ? (
            <Badge tone="brand" className="max-w-[14rem] truncate">
              <FileText className="h-3 w-3 shrink-0" /> {filename}
            </Badge>
          ) : (
            <span className="text-[11px] text-muted-foreground">{t('upload.dropOrChoose')}</span>
          )}
          {chars > 0 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t('upload.linesChars', { lines, chars: chars.toLocaleString() })}
            </span>
          ) : null}
          {actions ? <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div> : null}
        </div>
        <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{hint}</p>
      </div>

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  )
}
