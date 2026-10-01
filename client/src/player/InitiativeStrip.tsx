import { useEffect, useState } from 'react';
import { imageFileUrl, type PlayerEncounter, type PlayerToken } from '@emberglass/shared';
import { initialsOf } from '../canvas/TokenLayer.js';
import { Icon } from '../ui/icons.js';
import { t } from '../ui/messages.js';

// The initiative strip along the top edge of the TV (TBL-06, specs/08-ux-journeys.md §12, specs/04-live-sync.md
// §4, §14, Q-104): while combat runs, the player characters players see, each with its portrait and name, and
// one Enemies card, in turn order; the turn's card highlighted, the next one marked, the round at the left
// end. It draws only what the players' projection carries, which names no monster or npc and gives no count
// of them. It fades in when combat starts and out when it ends, as scene changes do.

/** How long the strip takes to fade out when combat ends: the scene fade's length. */
export const STRIP_FADE_MS = 400;

export function InitiativeStrip({
  encounter,
  tokens,
}: {
  encounter: PlayerEncounter | null;
  tokens: readonly PlayerToken[];
}) {
  // The strip last shown, kept while it fades out after combat ends.
  const [shown, setShown] = useState(encounter);
  if (encounter !== null && encounter !== shown) setShown(encounter);
  const leaving = encounter === null && shown !== null;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setShown(null), STRIP_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  const strip = encounter ?? shown;
  if (strip === null) return null;
  const byId = new Map(tokens.map((token) => [token.id, token]));
  return (
    <div
      className={leaving ? 'eg-player__initiative eg-player__initiative--leaving' : 'eg-player__initiative'}
      aria-label={t('initiative.tvLabel')}
      data-initiative={leaving ? 'leaving' : 'shown'}
    >
      <span className="eg-player__initiative-round">{t('initiative.tvRound', { round: strip.round })}</span>
      <span className="eg-player__initiative-cards" role="list">
        {strip.entries.map((entry, index) => {
          const token = entry.kind === 'pc' ? byId.get(entry.token_id) : undefined;
          // A player character's card needs its token, which players see whenever the entry reaches them.
          if (entry.kind === 'pc' && token === undefined) return null;
          const current = index === strip.current;
          const next = index === strip.next;
          const className = [
            'eg-player__initiative-card',
            entry.kind === 'dm' ? 'eg-player__initiative-card--enemies' : '',
            current ? 'eg-player__initiative-card--current' : '',
            next ? 'eg-player__initiative-card--next' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const name = token ? token.label : t('initiative.enemies');
          return (
            <span key={entry.id} className={className} role="listitem" data-entry={entry.id} data-kind={entry.kind}>
              <span className="eg-player__initiative-portrait" aria-hidden="true">
                {token ? (
                  <>
                    <span className="eg-player__initiative-initials">{initialsOf(token.label)}</span>
                    <img src={imageFileUrl(token.image_id, 'display')} alt="" />
                  </>
                ) : (
                  <Icon name="swords" size={28} strokeWidth={2} />
                )}
              </span>
              <span className="eg-player__initiative-name">{name}</span>
              {current ? <span className="eg-player__initiative-tag">{t('initiative.tvNow')}</span> : null}
              {next ? (
                <span className="eg-player__initiative-tag eg-player__initiative-tag--next">
                  {t('initiative.tvNext')}
                </span>
              ) : null}
            </span>
          );
        })}
      </span>
    </div>
  );
}
