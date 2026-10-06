import type { AssetCategory, FogMask, SceneToken } from '@emberglass/shared';
import { underFog } from '../fog/FogPanel.js';
import { Icon } from '../../ui/icons.js';
import { t, type MessageKey } from '../../ui/messages.js';
import { initialsOf } from '../../canvas/TokenLayer.js';
import { markerName } from '../../ui/conditions.js';
import { TokenStatsBadge } from './TokenStats.js';
import { NoteMark } from '../notes/Notes.js';

const CATEGORY_NAMES: Record<AssetCategory, MessageKey> = {
  pc: 'asset.category.pc',
  npc: 'asset.category.npc',
  monster: 'asset.category.monster',
  object: 'asset.category.object',
};

/** The groups of the list, in order: the party, the monsters, and every other token (UIX-01). */
const GROUPS: { key: 'party' | 'monsters' | 'others'; heading: MessageKey; categories: AssetCategory[] }[] = [
  { key: 'party', heading: 'sceneTokens.party', categories: ['pc'] },
  { key: 'monsters', heading: 'sceneTokens.monsters', categories: ['monster'] },
  { key: 'others', heading: 'sceneTokens.others', categories: ['npc', 'object'] },
];

// "In this scene", the right panel's first tab (UIX-01, specs/08-ux-journeys.md §11): the scene's tokens
// grouped into the party (player characters), the monsters, with Reveal all while any is hidden, and every
// other token (NPCs and objects, which the design draws no group for). Each row names its token and says
// what it is or that it is hidden, with its eye toggle and, when it has notes of its own or from its asset, a page
// mark whose hover text is their first lines (DMT-04); a hidden row is italic, its avatar ring dashed and
// its eye crossed out, so it never reads as a visible one. A row selects its token and centres the map on
// it. Every control is a native button, so the keyboard reaches all of it.
/**
 * A row's status line: hidden or what it is, then whether it stands under the fog (TBL-04), then its condition
 * markers (TBL-02, TBL-05), if any, in the order applied.
 */
function statusOf(token: SceneToken, fog: FogMask): string {
  const own = token.hidden ? t('sceneTokens.hidden') : t(CATEGORY_NAMES[token.asset.category]);
  const status = underFog(token, fog) ? t('sceneTokens.inFog', { status: own }) : own;
  if (token.markers.length === 0) return status;
  const markers = token.markers.map(markerName).join(t('sceneTokens.markerSeparator'));
  return t('sceneTokens.withMarkers', { status, markers });
}

export function TokenList({
  tokens,
  selectedId,
  selectedIds,
  onSelect,
  onToggle,
  onToggleHidden,
  onRevealAll,
  onAdd,
  fog = [],
}: {
  tokens: readonly SceneToken[];
  /** The scene's painted fog, which a token's status says it stands under (TBL-04). */
  fog?: FogMask;
  selectedId: string | undefined;
  /** Several selected (UXR-02): every one is marked selected. */
  selectedIds?: readonly string[] | undefined;
  onSelect: (token: SceneToken) => void;
  /** Ctrl (Cmd on macOS) and a click on a row: the token joins the selection or leaves it (UXR-02). */
  onToggle?: ((token: SceneToken) => void) | undefined;
  onToggleHidden: (token: SceneToken) => void;
  onRevealAll: (tokens: SceneToken[]) => void;
  /** Add token; absent while tokens cannot be added. */
  onAdd?: (() => void) | undefined;
}) {
  if (tokens.length === 0) {
    return (
      <div className="eg-token-list">
        <p className="eg-dm__status">{t('sceneTokens.empty')}</p>
        {onAdd ? (
          <div>
            <button type="button" className="eg-button eg-button--small" onClick={onAdd}>
              <Icon name="addToken" />
              {t('tokens.add')}
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="eg-token-list">
      {GROUPS.map((group) => {
        const members = tokens.filter((token) => group.categories.includes(token.asset.category));
        if (members.length === 0) return null;
        const hidden = members.filter((token) => token.hidden);
        return (
          <section
            key={group.key}
            className="eg-token-list__group"
            aria-label={t(group.heading, { count: members.length })}
          >
            <div className="eg-token-list__head">
              <h2 className="eg-token-list__heading">{t(group.heading, { count: members.length })}</h2>
              {group.key === 'monsters' && hidden.length > 0 ? (
                <button type="button" className="eg-button eg-button--tiny" onClick={() => onRevealAll(hidden)}>
                  {t('sceneTokens.revealAll')}
                </button>
              ) : null}
            </div>
            <ul className="eg-token-list__rows">
              {members.map((token) => (
                <li
                  key={token.id}
                  className={
                    (selectedIds?.includes(token.id) ?? token.id === selectedId)
                      ? 'eg-token-row eg-token-row--selected'
                      : 'eg-token-row'
                  }
                  data-hidden={token.hidden || undefined}
                  data-token={token.id}
                >
                  <button
                    type="button"
                    className="eg-token-row__select"
                    aria-current={(selectedIds?.includes(token.id) ?? token.id === selectedId) || undefined}
                    onClick={(event) => {
                      if (onToggle && (event.ctrlKey || event.metaKey)) onToggle(token);
                      else onSelect(token);
                    }}
                  >
                    <span className={`eg-avatar eg-avatar--${token.asset.category}`} aria-hidden="true">
                      {initialsOf(token.label)}
                    </span>
                    <span className="eg-token-row__text">
                      <span className="eg-token-row__name">{token.label}</span>
                      <span className="eg-token-row__status">{statusOf(token, fog)}</span>
                    </span>
                    <NoteMark token={token} />
                    <TokenStatsBadge stats={token} />
                  </button>
                  <button
                    type="button"
                    className="eg-icon-button eg-token-row__eye"
                    aria-label={t(token.hidden ? 'sceneTokens.revealOf' : 'sceneTokens.hideOf', { label: token.label })}
                    onClick={() => onToggleHidden(token)}
                  >
                    <Icon name={token.hidden ? 'eyeOff' : 'eye'} size={17} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
