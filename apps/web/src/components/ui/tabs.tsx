import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

/**
 * Two shapes, chosen by how many tabs there are.
 *
 * `segmented` is the reference language's pill track and is right for a scope
 * switch of three or four options.
 *
 * `merged` is for a record's sections — twelve of them on a vehicle — where a
 * pill track becomes a long filled slab across the page that outweighs the
 * content beneath it. It draws the selected section as a folder tab in the page
 * colour whose bottom corners sweep outward into the panel below, so the tab
 * and its content read as one surface. That merge is why this variant has a
 * track at all: the tab has to differ from what is behind it and match what is
 * beneath it, and on a page-coloured row a page-coloured tab is invisible.
 *
 * The variant is set on the list and read by the triggers through a data
 * attribute, so a caller states it once where the count is visible rather than
 * repeating it on every trigger.
 */
type TabsVariant = 'segmented' | 'merged';

const LIST_VARIANTS: Record<TabsVariant, string> = {
  segmented:
    'h-11 items-center rounded-full bg-muted/80 p-1 ring-1 ring-foreground/[0.04] dark:bg-white/[0.04] dark:ring-white/[0.05]',
  /*
   * `flex w-fit mx-auto` centres the row: the shared base is `inline-flex`,
   * which `mx-auto` cannot centre, and tailwind-merge resolves the two display
   * utilities in favour of this one.
   *
   * No bottom padding — the tab's lower edge has to *be* the track's lower
   * edge, or it cannot meet the panel below and the merge reads as a gap.
   */
  // `px-3` is not arbitrary: it must exceed --tab-merge-r (10px), or the first
  // and last tab's outer fillet falls outside the track and is clipped by the
  // strip's own horizontal overflow, leaving a nicked corner.
  merged: 'mx-auto flex h-auto w-fit items-end gap-1 rounded-t-xl bg-tab-track px-3 pt-2',
};

/**
 * Where the selected trigger sits, so the tab can slide to it.
 *
 * Measured from the DOM rather than derived from the selected value: Radix
 * marks the active trigger with `data-state`, and these widths come from the
 * label text, so there is nothing to compute from the value alone.
 *
 * Null until a measurement exists, so the tab is not rendered at zero width and
 * then animated out of the left edge on first paint.
 */
function useActiveTriggerBox(listRef: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [box, setBox] = React.useState<{ left: number; width: number } | null>(null);

  React.useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return undefined;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      // `offsetLeft` is measured from the list, which is the offset parent, so
      // the tab tracks the triggers as the strip scrolls sideways.
      setBox(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };

    measure();

    // Radix swaps `data-state` on the triggers; that is the only signal that
    // the selection moved.
    const states = new MutationObserver(measure);
    states.observe(list, { attributes: true, attributeFilter: ['data-state'], subtree: true });

    // Labels reflow when the web font lands or the strip is resized, which
    // moves the target without changing any attribute.
    const sizes = new ResizeObserver(measure);
    sizes.observe(list);
    for (const trigger of list.querySelectorAll('[role="tab"]')) sizes.observe(trigger);

    return () => {
      states.disconnect();
      sizes.disconnect();
    };
  }, [listRef, enabled]);

  return box;
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = 'segmented', children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const merged = variant === 'merged';
  const box = useActiveTriggerBox(listRef, merged);

  return (
    <TabsPrimitive.List
      ref={(node) => {
        listRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      data-variant={variant}
      className={cn(
        'group/tabs relative inline-flex max-w-full justify-start text-muted-foreground',
        // A long strip does not fit a phone; scroll it rather than pushing the
        // page sideways.
        'overflow-x-auto scrollbar-none',
        LIST_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {/*
        One tab that moves, rather than a background switched on and off per
        trigger.

        Switching it per trigger means that for a frame the shape is drawn in
        two places or in none, and the track shows through where it had been —
        the same flicker the rail's notch had. A single element given a new
        position and width is continuous. It also has to be a real element
        rather than a style on the trigger, because the fillets are its
        pseudo-elements and they have to travel with it.

        Rendered before the triggers and left at the default z-index, so the
        trigger labels — which carry `relative z-10` — stay above it.
      */}
      {merged && box ? (
        <span
          aria-hidden
          className="tab-merge pointer-events-none absolute bottom-0 left-0 top-2 rounded-t-lg transition-[transform,width] duration-300 ease-smooth"
          style={{ transform: `translateX(${box.left}px)`, width: box.width }}
        />
      ) : null}

      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative z-10 inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ease-smooth',
      'hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-foreground/[0.05]',
      'dark:data-[state=active]:bg-white/[0.10] dark:data-[state=active]:ring-white/[0.08]',
      /*
       * Under `merged` the trigger is only a label. Its own pill is undone
       * because the shape behind it is the sliding tab, and two backgrounds
       * would show as a chip floating inside the tab.
       */
      'group-data-[variant=merged]/tabs:rounded-t-lg group-data-[variant=merged]/tabs:px-4 group-data-[variant=merged]/tabs:pb-2.5 group-data-[variant=merged]/tabs:pt-2',
      'group-data-[variant=merged]/tabs:data-[state=active]:bg-transparent group-data-[variant=merged]/tabs:data-[state=active]:shadow-none group-data-[variant=merged]/tabs:data-[state=active]:ring-0',
      'dark:group-data-[variant=merged]/tabs:data-[state=active]:bg-transparent',
      '[&_svg]:size-4',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-6 focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
