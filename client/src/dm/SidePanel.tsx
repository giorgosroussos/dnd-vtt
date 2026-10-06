import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../ui/messages.js';

export type SideTab = 'scene' | 'initiative' | 'notes' | 'library';
const TABS: readonly SideTab[] = ['scene', 'initiative', 'notes', 'library'];
const LABELS = {
  scene: 'side.scene',
  initiative: 'side.initiative',
  notes: 'side.notes',
  library: 'side.library',
} as const;

// The right-hand panel of the workspace (UIX-01, specs/08-ux-journeys.md §1, §11, §12, §13, Q-100, Q-104, Q-114):
// four tabs, the tokens of the scene being shown, its initiative order, its notes and the asset library, in the tabs
// pattern: the arrow keys move between the tabs, which switch at once. Every tab stays in the Tab order, so Tab alone
// reaches each. While combat runs, the Initiative tab names the round.
export function SidePanel({
  tab,
  onTab,
  scene,
  initiative,
  notes,
  round,
  library,
}: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  /** The scene's tokens, or undefined while no scene is shown. */
  scene: ReactNode;
  /** The scene's initiative order, or undefined while no scene is shown. */
  initiative?: ReactNode;
  /** The scene's notes (DMT-04), or undefined while no scene is shown. */
  notes?: ReactNode;
  /** The round, while combat runs on the scene shown. */
  round?: number | undefined;
  library: ReactNode;
}) {
  const id = useId();
  const tabs = useRef<Record<SideTab, HTMLButtonElement | null>>({
    scene: null,
    initiative: null,
    notes: null,
    library: null,
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : TABS.length - 1;
    const next = TABS[(TABS.indexOf(tab) + step) % TABS.length]!;
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
            {each === 'initiative' && round !== undefined ? t('side.initiativeRound', { round }) : t(LABELS[each])}
          </button>
        ))}
      </div>
      <div className="eg-side__panel" role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === 'library'
          ? library
          : ((tab === 'scene' ? scene : tab === 'notes' ? notes : initiative) ?? (
              <p className="eg-dm__status">{t('side.noScene')}</p>
            ))}
      </div>
    </aside>
  );
}
