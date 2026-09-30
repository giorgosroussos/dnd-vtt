import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Shown but refused, with the reason read out beside the item. */
  disabledReason?: string | undefined;
  danger?: boolean;
}

// A menu button (UIX-01, specs/08-ux-journeys.md §8): the button opens a list of actions in the menu
// pattern. Arrow keys move between items, Home and End go to the ends, Enter or Space runs one, Escape
// or a click elsewhere closes it and focus goes back to the button. An item that cannot run now stays
// in the list, refusing, with its reason, so the keyboard meets the same items every time.
export function Menu({
  label,
  icon,
  items,
  className = 'eg-icon-button',
}: {
  /** The button's accessible name. */
  label: string;
  icon: ReactNode;
  items: readonly MenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const itemsOf = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    itemsOf()[0]?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    const all = itemsOf();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (index: number) => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(false);
  }

  return (
    <span className="eg-menu">
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
      </button>
      {open ? (
        <ul ref={list} id={menuId} className="eg-menu__list" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={item.danger ? 'eg-menu__item eg-menu__item--danger' : 'eg-menu__item'}
                aria-disabled={item.disabledReason !== undefined || undefined}
                onClick={() => {
                  if (item.disabledReason !== undefined) return;
                  // Focus back on the button first, so a dialog the item opens returns it there.
                  close(true);
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.disabledReason ? <span className="eg-menu__reason">{item.disabledReason}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
