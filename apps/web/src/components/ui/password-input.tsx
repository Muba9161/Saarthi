import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

/**
 * A password field that can be read back.
 *
 * Typing a ten-character password with three character classes into a row of
 * dots, on a phone, in a language the keyboard is guessing at, is where most
 * failed sign-ups come from. The reveal toggle is the fix — and it belongs in
 * one component rather than being re-implemented per screen, so every password
 * field in Saarthi behaves identically.
 *
 * The toggle is `tabIndex={-1}`: tabbing out of a password field should reach
 * the submit button, not an eye icon. It stays reachable by pointer and by
 * screen readers, which is who it is for.
 */
export type PasswordInputProps = Omit<InputProps, 'type'>;

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const t = useT();
    const [revealed, setRevealed] = React.useState(false);
    const label = revealed ? t('Hide password') : t('Show password');

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={revealed ? 'text' : 'password'}
          className={cn('pr-10', className)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
          aria-label={label}
          title={label}
          className={cn(
            'absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md',
            'text-muted-foreground transition-colors',
            'hover:bg-foreground/5 hover:text-foreground dark:hover:bg-white/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
