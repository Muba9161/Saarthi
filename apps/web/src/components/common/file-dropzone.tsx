import * as React from 'react';
import { FileText, Loader2, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Drag-and-drop file picker.
 *
 * A bare `<input type="file">` gives no target to drag onto and no feedback
 * that a drag is even possible, which on a desktop is how most people expect
 * to attach a photograph of an RC book they have just scanned. This gives the
 * drop target, the hover state, and the rules — accepted types, size, how many
 * are left — before the file is chosen rather than as an error afterwards.
 *
 * It holds no files of its own. Callers own that state, because one of them
 * uploads immediately and the other waits for a form submit.
 */

/**
 * Does a file satisfy an `accept` attribute?
 *
 * Browsers apply `accept` to the file chooser but not to a drop, so a dropped
 * file has to be checked here or a `.docx` would sail into an image gallery.
 * Handles all three forms: `.ext`, `type/subtype`, and `type/*`.
 */
export function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;

  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();

  return accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return mime.startsWith(`${rule.slice(0, -1)}`);
      return mime === rule;
    });
}

export interface FileDropzoneProps {
  /** Same syntax as the input attribute; also enforced on drop. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Shows a spinner and blocks further picking. */
  busy?: boolean;
  busyLabel?: string;
  /** Receives only the files that passed the type, size and count checks. */
  onFiles: (files: File[]) => void;
  /** Extra files beyond this are dropped silently — the caller shows the cap. */
  maxFiles?: number;
  maxSizeMb?: number;
  /** Reported when a file is rejected. Defaults to a toast-free no-op. */
  onReject?: (reason: string) => void;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Short form for tight spaces — one line, no icon block. */
  compact?: boolean;
  className?: string;
}

export function FileDropzone({
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  busyLabel = 'Uploading…',
  onFiles,
  maxFiles,
  maxSizeMb,
  onReject,
  title,
  hint,
  icon: Icon = UploadCloud,
  compact = false,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  /**
   * Dragging over a child fires `dragleave` on the parent, so tracking a
   * boolean alone makes the highlight flicker. Counting enters and leaves is
   * the standard fix.
   */
  const depth = React.useRef(0);

  const locked = disabled || busy;

  const accepted = React.useCallback(
    (candidates: File[]): File[] => {
      const keep: File[] = [];

      for (const file of candidates) {
        if (!matchesAccept(file, accept)) {
          onReject?.(`${file.name} is not a supported file type.`);
          continue;
        }
        if (maxSizeMb !== undefined && file.size > maxSizeMb * 1024 * 1024) {
          onReject?.(`${file.name} is larger than ${maxSizeMb} MB.`);
          continue;
        }
        keep.push(file);
      }

      return maxFiles !== undefined ? keep.slice(0, maxFiles) : keep;
    },
    [accept, maxFiles, maxSizeMb, onReject],
  );

  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (locked) return;

    const dropped = Array.from(event.dataTransfer.files ?? []);
    const usable = accepted(multiple ? dropped : dropped.slice(0, 1));
    if (usable.length > 0) onFiles(usable);
  };

  return (
    <>
      <button
        type="button"
        disabled={locked}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          if (!locked) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          depth.current -= 1;
          if (depth.current <= 0) {
            depth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
        aria-busy={busy || undefined}
        className={cn(
          'flex w-full items-center justify-center rounded-xl border border-dashed text-center',
          'transition-all duration-200 ease-smooth',
          compact ? 'gap-3 px-4 py-3' : 'flex-col gap-2 px-4 py-6',
          dragging
            ? 'border-primary bg-primary/[0.07] text-primary shadow-glow'
            : 'border-border-strong/70 bg-white/40 text-muted-foreground dark:bg-white/[0.03]',
          !locked &&
            !dragging &&
            'hover:border-primary/60 hover:bg-white/60 hover:text-primary dark:hover:bg-white/[0.06]',
          locked && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        {busy ? (
          <Loader2 className={cn('animate-spin', compact ? 'size-4' : 'size-6')} />
        ) : (
          <Icon
            className={cn(
              'transition-transform duration-200',
              compact ? 'size-4' : 'size-6',
              dragging && 'scale-110',
            )}
          />
        )}

        <span className={cn('min-w-0', compact ? 'text-left' : '')}>
          <span className="block text-sm font-medium">
            {busy ? busyLabel : dragging ? 'Drop to upload' : (title ?? 'Drop files here')}
          </span>
          {hint && !busy ? (
            <span className="mt-0.5 block text-xs leading-snug opacity-80">{hint}</span>
          ) : null}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          const usable = accepted(picked);
          if (usable.length > 0) onFiles(usable);
          // Let the same file be re-picked after a failed upload.
          event.target.value = '';
        }}
      />
    </>
  );
}

/** An object URL for a local file, revoked when the file changes or unmounts. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The chosen file, with a way to change your mind.
 *
 * Images preview; anything else — a PDF, most often — shows its name and size,
 * which is the only thing that distinguishes two scans of the same page.
 */
export function FilePreviewCard({
  file,
  onRemove,
  disabled = false,
  className,
}: {
  file: File;
  onRemove: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const preview = useObjectUrl(file);

  return (
    <div className={cn('glass-inset flex items-center gap-3 p-2.5', className)}>
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {preview ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <FileText className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">{readableSize(file.size)}</p>
      </div>

      <RemoveButton
        onClick={onRemove}
        disabled={disabled}
        label={`Remove ${file.name}`}
        className="static shrink-0"
      />
    </div>
  );
}

/**
 * The cross that takes an attachment back off.
 *
 * Always visible rather than revealed on hover: on a touch screen there is no
 * hover, and a remove control that cannot be found is a photograph that cannot
 * be replaced.
 */
export function RemoveButton({
  onClick,
  disabled = false,
  label,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'absolute right-1.5 top-1.5 z-10 flex size-6 items-center justify-center rounded-full',
        'border border-white/50 bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm',
        'transition-all duration-150 ease-smooth',
        'hover:scale-110 hover:border-destructive/50 hover:bg-destructive hover:text-destructive-foreground',
        'focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50',
        'dark:border-white/10',
        className,
      )}
    >
      <X className="size-3.5" strokeWidth={2.5} />
    </button>
  );
}
