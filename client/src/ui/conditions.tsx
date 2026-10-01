import { conditionOf, markerLevel, type TokenMarker } from '@emberglass/shared';
import { t } from './messages.js';

// The condition markers as the DM view names and draws them outside the canvas (TBL-05, D-157, D-158). Their
// labels and rule text are data, from shared/src/conditions.json, as the owner asked, not catalogue strings;
// the sentences around them are the catalogue's.

/** A condition's label, or its id when the list does not know it (a marker from a later version). */
export const conditionLabel = (id: string): string => conditionOf(id)?.label ?? id;

/** A marker as a row or a message names it: its label, and Exhaustion's level. */
export function markerName(marker: TokenMarker): string {
  const level = markerLevel(marker);
  const label = conditionLabel(marker.id);
  return level === undefined ? label : t('conditions.withLevel', { label, level });
}

/** The hover text of a condition's chip: its rule text, then the conditions it implies, which are not applied. */
export function conditionHelp(id: string): string {
  const condition = conditionOf(id);
  if (!condition) return conditionLabel(id);
  const lines = [...condition.rule];
  if (condition.implies.length > 0) {
    lines.push(t('conditions.implies', { conditions: condition.implies.map(conditionLabel).join(', ') }));
  }
  return lines.join('\n');
}

/** A condition's icon as HTML, sized by the text around it; decoration, as the chip is named by its label. */
export function ConditionIcon({ id, size = 14 }: { id: string; size?: number }) {
  const path = conditionOf(id)?.icon.path;
  if (path === undefined) return null;
  return (
    <svg
      className="eg-condition-icon"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
