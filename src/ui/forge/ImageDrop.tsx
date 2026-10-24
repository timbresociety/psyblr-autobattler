import { useRef, useState, type DragEvent } from 'react'
import type { LookColor } from '../../charter/look'
import type { FaceFinding } from './face/find'

/** One reference image on its way in: shrunk in the browser, then uploaded. */
export interface RefImage {
  id: string
  name: string
  /** An object URL of the shrunk image, once it exists. */
  preview?: string
  status: 'preparing' | 'uploading' | 'ready'
  url?: string
  /** The face on it, null when there is none, undefined until it has been looked for. */
  face?: FaceFinding | null
  /** The outfit's colours on it, for an offline reading. */
  outfit?: Partial<Record<LookColor, string>>
}

interface Props {
  images: RefImage[]
  max: number
  onFiles: (files: File[]) => void
  onRemove: (id: string) => void
  /** The last image that couldn't be used, and why. */
  error?: string
}

const STATUS_LABEL: Record<RefImage['status'], string> = { preparing: 'Preparing', uploading: 'Uploading', ready: 'Ready' }

const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')

/** Everything the player hands over as a picture: an image type, or a photo extension the browser didn't type. */
export const imageFiles = (list: Iterable<File>) => [...list].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|avif|jpe?g|png|webp|gif|bmp)$/i.test(f.name))

/**
 * Reference images: drop them, paste them (the Forge listens for a pasted image anywhere on the page) or browse. Each
 * shows its own status, and an image that can't be used says why instead of quietly disappearing.
 */
export function ImageDrop({ images, max, onFiles, onRemove, error }: Props) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const full = images.length >= max
  const take = (list: FileList | null | undefined) => {
    const files = imageFiles(list ?? [])
    if (files.length) onFiles(files)
  }
  return (
    <div
      className={`drop${over ? ' over' : ''}${full ? ' full' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = full ? 'none' : 'copy'
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        // the Forge's own drop handler would take these too
        e.stopPropagation()
        setOver(false)
        if (!full) take(e.dataTransfer.files)
      }}
    >
      <span className="field-label">
        Reference images <span className="count">{images.length}/{max}</span>
      </span>
      <div className="photo-slots">
        {images.map((img) => (
          <figure key={img.id} className={`ref ${img.status}`} title={`${img.name}: ${STATUS_LABEL[img.status]}`}>
            {img.preview ? <img src={img.preview} alt={img.name} /> : <span className="ref-wait" aria-hidden="true" />}
            {img.status !== 'ready' && <span className="sr-only">{STATUS_LABEL[img.status]}</span>}
            {img.face && (
              <span className="ref-face" title="Face found: your hero can wear it">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <circle cx="9" cy="10.5" r="1.3" fill="currentColor" />
                  <circle cx="15" cy="10.5" r="1.3" fill="currentColor" />
                  <path d="M8.5 14.5c1.9 1.9 5.1 1.9 7 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span className="sr-only">Face found</span>
              </span>
            )}
            <button type="button" className="ref-remove" aria-label={`Remove ${img.name}`} onClick={() => onRemove(img.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </figure>
        ))}
        {!full && (
          <button type="button" className="photo-add" title="Add reference images" onClick={() => input.current?.click()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Add reference images</span>
          </button>
        )}
        {Array.from({ length: Math.max(0, max - images.length - 1) }, (_, i) => (
          <span key={i} className="photo-empty" aria-hidden="true" />
        ))}
      </div>
      <p className="drop-hint">{over ? 'Drop to add.' : 'Drop images here, paste one, or browse. A clear photo of a face works best.'}</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <input
        ref={input}
        className="sr-only"
        aria-label="Reference images"
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        tabIndex={-1}
        disabled={full}
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
