import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../ui/messages.js';

export type SideTab = 'scene' | 'library';
const TABS: readonly SideTab[] = ['scene', 'library'];

// The right-hand panel of the workspace (UIX-01, specs/08-ux-journeys.md §1, §11, Q-100): two tabs, the
// tokens of the scene being shown and the asset library, in the tabs pattern: the arrow keys move between
// the tabs, which switch at once. Both tabs stay in the Tab order, so Tab alone reaches either.
export function SidePanel({
  tab,
  onTab,
  scene,
  library,
}: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  /** The scene's tokens, or undefined while no scene is shown. */
  scene: ReactNode;
  library: ReactNode;
}) {
  const id = useId();
  const tabs = useRef<Record<SideTab, HTMLButtonElement | null>>({ scene: null, library: null });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length]!;
    onTab(next);
    tabs.current[next]?.focus();
  };
  return (
    <aside className="eg-side" aria-label={t('side.label')}>
      <div className="eg-side__tabs" role="tablist" aria-label={t('side.label')} onKeyDown={onKeyDown}>
        {TABS.map((each) => (
          <button
            key={each}
            ref={(element) => {
              tabs.current[each] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-${each}`}
            className="eg-side__tab"
            aria-selected={tab === each}
            aria-controls={`${id}-${each}-panel`}
            onClick={() => onTab(each)}
          >
            {t(each === 'scene' ? 'side.scene' : 'side.library')}
          </button>
        ))}
      </div>
      <div className="eg-side__panel" role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === 'scene' ? (scene ?? <p className="eg-dm__status">{t('side.noScene')}</p>) : library}
      </div>
    </aside>
  );
}
