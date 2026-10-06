import { useEffect, useState } from 'react';
import { hasMarker, imageFileUrl, type PlayerEncounter, type PlayerToken } from '@emberglass/shared';
import { initialsOf } from '../canvas/TokenLayer.js';
import { t } from '../ui/messages.js';

// The initiative strip along the top edge of the TV (TBL-06, DMT-02, specs/08-ux-journeys.md §12,
// specs/04-live-sync.md §4, §14, Q-111, Q-118, Q-127): while combat runs, two cards only, the entry whose turn it
// is and the next one, player characters and enemies alike, each with its portrait and its token's label as the
// map shows it, in its side's ring colour; a Dead one greyed, the turn's card highlighted, the next one marked,
// the round at the left end. Each turn replaces them, the new cards fading in; a turn players cannot see shows the
// next card alone. It draws only what the players' projection carries and the tokens players
// already see. It fades in when combat starts and out when it ends, as scene changes do.

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
        {[strip.current, strip.next].map((index, place) => {
          // The same entry as the turn and the next (a single combatant) is shown once.
          if (index === null || (place === 1 && index === strip.current)) return null;
          const entry = strip.entries[index];
          if (entry === undefined) return null;
          const token = byId.get(entry.token_id);
          // A card needs its token, which players see whenever the entry reaches them.
          if (token === undefined) return null;
          const current = place === 0;
          const next = place === 1;
          const dead = hasMarker(token.markers, 'dead');
          const className = [
            'eg-player__initiative-card',
            `eg-player__initiative-card--${token.category}`,
            dead ? 'eg-player__initiative-card--dead' : '',
            current ? 'eg-player__initiative-card--current' : '',
            next ? 'eg-player__initiative-card--next' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <span
              // Keyed by the turn too, so that each turn's cards fade in anew.
              key={`${strip.round}:${strip.current ?? 'none'}:${entry.id}`}
              className={className}
              role="listitem"
              data-entry={entry.id}
              data-kind={entry.kind}
              data-dead={dead || undefined}
            >
              <span className="eg-player__initiative-portrait" aria-hidden="true">
                <span className="eg-player__initiative-initials">{initialsOf(token.label)}</span>
                <img src={imageFileUrl(token.image_id, 'display')} alt="" />
              </span>
              <span className="eg-player__initiative-name">{token.label}</span>
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
