import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/icons.js';
import { IconButton } from '../ui/IconButton.js';
import { t } from '../ui/messages.js';
import { useFocusLater } from '../ui/useFocusLater.js';

// Where this browser remembers that the DM docked the scene sidebar (UXR-01). A convenience only: it may be
// missing or refused, and the sidebar then starts collapsed.
export const SIDEBAR_KEY = 'emberglass.sidebar';
const rememberedPinned = (): boolean => {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'pinned';
  } catch {
    return false;
  }
};
const rememberPinned = (pinned: boolean): void => {
  try {
    if (pinned) window.localStorage.setItem(SIDEBAR_KEY, 'pinned');
    else window.localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    // Storage refused: the choice lasts until the page reloads.
  }
};

/** How long the pointer may be away before a sidebar opened by hover closes. */
export const SIDEBAR_CLOSE_MS = 250;

// The scene sidebar's dock (UXR-01, specs/08-ux-journeys.md §1, §14, Q-121). Collapsed, the default, it is a
// strip at the left edge: the pointer on it opens the sidebar over the map, without resizing the map, and
// leaving closes it after a moment; the strip's button opens it on a click, and then it stays until the
// button, Escape or a click elsewhere closes it. It stays open while it holds the keyboard focus, a drag
// or a dialog of its own. The pin docks it in its column, as before the refinements, and the browser
// remembers it. Closed, it is hidden, so nothing in it takes the focus.
export function SidebarDock({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState(rememberedPinned);
  const [open, setOpen] = useState<false | 'hover' | 'click'>(false);
  const dock = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  const focusLater = useFocusLater();

  const cancelClose = () => {
    clearTimeout(closing.current);
    closing.current = undefined;
  };
  // What keeps a sidebar open by hover when the pointer leaves: a drag, a dialog of its own, the keyboard focus.
  const held = () => {
    const root = dock.current;
    if (!root) return false;
    if (dragging.current || root.querySelector('dialog[open]')) return true;
    const focused = document.activeElement;
    return focused instanceof HTMLElement && root.contains(focused) && focused.matches(':focus-visible');
  };
  const closeSoon = () => {
    cancelClose();
    closing.current = setTimeout(() => {
      closing.current = undefined;
      if (!held()) setOpen((now) => (now === 'hover' ? false : now));
    }, SIDEBAR_CLOSE_MS);
  };
  useEffect(() => cancelClose, []);

  // Opened by a click, it closes on a press anywhere outside it.
  useEffect(() => {
    if (open !== 'click') return;
    const outside = (event: PointerEvent) => {
      if (dock.current?.contains(event.target as Node)) return;
      if (document.querySelector('dialog[open]')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const pin = (next: boolean) => {
    setPinned(next);
    rememberPinned(next);
    setOpen(false);
    if (!next) focusLater(() => toggle.current);
  };

  const shown = pinned || open !== false;
  return (
    <div
      ref={dock}
      className={`eg-dock${pinned ? ' eg-dock--pinned' : ''}${shown ? ' eg-dock--open' : ''}`}
      data-sidebar={pinned ? 'pinned' : shown ? 'open' : 'collapsed'}
      onPointerEnter={(event) => {
        if (pinned || event.pointerType === 'touch') return;
        cancelClose();
        setOpen((now) => now || 'hover');
      }}
      onPointerLeave={() => {
        if (!pinned && open === 'hover') closeSoon();
      }}
      onDragStart={() => {
        dragging.current = true;
      }}
      onDragEnd={() => {
        dragging.current = false;
      }}
      onFocus={(event) => {
        const target = event.target as HTMLElement;
        if (!pinned && target !== toggle.current && target.matches(':focus-visible')) {
          setOpen((now) => now || 'hover');
        }
      }}
      onBlur={(event) => {
        if (!pinned && open === 'hover' && !dock.current?.contains(event.relatedTarget)) closeSoon();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || pinned || open === false || event.defaultPrevented) return;
        if (dock.current?.querySelector('dialog[open]')) return;
        event.stopPropagation();
        setOpen(false);
        toggle.current?.focus();
      }}
    >
      {pinned ? null : (
        <button
          ref={toggle}
          type="button"
          className="eg-dock__edge"
          aria-expanded={shown}
          aria-controls={id}
          aria-label={shown ? t('sidebar.hide') : t('sidebar.show')}
          onClick={() => setOpen((now) => (now === 'click' ? false : 'click'))}
        >
          <Icon name="sidebar" size={14} />
        </button>
      )}
      <div id={id} className="eg-workspace__sidebar" inert={!shown}>
        <div className="eg-dock__bar">
          <IconButton
            icon="pin"
            label={pinned ? t('sidebar.unpin') : t('sidebar.pin')}
            aria-pressed={pinned}
            onClick={() => pin(!pinned)}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
