import type { ComponentType } from 'react';
import {
  Facebook,
  Linkedin,
  Mail,
  MessageCircle,
  MessageSquareText,
  Send,
  Twitter,
} from 'lucide-react';
import { motion, useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

interface Platform {
  name: string;
  icon: ComponentType<{ className?: string }>;
  /** Brand tint for the circle and the icon. */
  className: string;
  href: (link: { url: string; text: string }) => string;
  /** mailto: and sms: hand over to an app, so they stay in this tab. */
  sameTab?: boolean;
}

const e = encodeURIComponent;

/**
 * Where a referral can be shared, in the order Saarthi's users actually share.
 * Instagram and similar apps have no share-by-link address; the device Share
 * button beside this row reaches them through the phone's own share sheet.
 */
const PLATFORMS: readonly Platform[] = [
  {
    name: 'WhatsApp',
    icon: MessageCircle,
    className: 'bg-[#25D366]/10 text-[#1DA851] ring-[#25D366]/25',
    href: ({ text }) => `https://wa.me/?text=${e(text)}`,
  },
  {
    name: 'Telegram',
    icon: Send,
    className: 'bg-[#229ED9]/10 text-[#229ED9] ring-[#229ED9]/25',
    href: ({ url, text }) => `https://t.me/share/url?url=${e(url)}&text=${e(text)}`,
  },
  {
    name: 'Facebook',
    icon: Facebook,
    className: 'bg-[#1877F2]/10 text-[#1877F2] ring-[#1877F2]/25',
    href: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`,
  },
  {
    name: 'X',
    icon: Twitter,
    className: 'bg-foreground/[0.07] text-foreground ring-foreground/15',
    href: ({ url, text }) => `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}`,
  },
  {
    name: 'LinkedIn',
    icon: Linkedin,
    className: 'bg-[#0A66C2]/10 text-[#0A66C2] ring-[#0A66C2]/25',
    href: ({ url }) => `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`,
  },
  {
    name: 'Email',
    icon: Mail,
    className: 'bg-primary/10 text-primary ring-primary/20',
    href: ({ text }) => `mailto:?subject=${e('Join me on Saarthi')}&body=${e(text)}`,
    sameTab: true,
  },
  {
    name: 'SMS',
    icon: MessageSquareText,
    className: 'bg-warning/10 text-warning ring-warning/25',
    href: ({ text }) => `sms:?body=${e(text)}`,
    sameTab: true,
  },
];

/**
 * One-tap sharing to each platform.
 *
 * The row pops in one icon at a time and each icon lifts and wiggles under the
 * pointer, so the screen feels alive without anything moving on its own. All
 * of it is dropped for anyone who has asked their device for reduced motion.
 */
export function ShareLinks({ url, text }: { url: string; text: string }) {
  const reduced = useReducedMotion();

  return (
    <motion.ul
      className="grid grid-cols-4 gap-3 sm:flex sm:flex-wrap sm:gap-2"
      aria-label="Share your referral link"
      {...(reduced
        ? {}
        : {
            initial: 'hidden',
            animate: 'visible',
            variants: { visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } },
          })}
    >
      {PLATFORMS.map((platform) => {
        const Icon = platform.icon;
        return (
          <motion.li
            key={platform.name}
            {...(reduced
              ? {}
              : {
                  variants: {
                    hidden: { opacity: 0, scale: 0.6, y: 8 },
                    visible: {
                      opacity: 1,
                      scale: 1,
                      y: 0,
                      transition: { type: 'spring', stiffness: 420, damping: 22 },
                    },
                  },
                })}
          >
            <motion.a
              href={platform.href({ url, text })}
              {...(platform.sameTab ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              aria-label={`Share on ${platform.name}`}
              className="group flex flex-col items-center gap-1.5 rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...(reduced ? {} : { whileHover: 'hover', whileTap: { scale: 0.9 } })}
            >
              <motion.span
                className={cn(
                  'flex size-12 items-center justify-center rounded-full ring-1 transition-shadow duration-200 group-hover:shadow-md',
                  platform.className,
                )}
                variants={{ hover: { y: -4 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              >
                <motion.span
                  className="flex"
                  variants={{ hover: { rotate: [0, -14, 12, -6, 0], scale: 1.12 } }}
                  transition={{ duration: 0.5 }}
                >
                  <Icon className="size-5" aria-hidden />
                </motion.span>
              </motion.span>
              <span className="text-2xs font-medium text-muted-foreground group-hover:text-foreground">
                {platform.name}
              </span>
            </motion.a>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
