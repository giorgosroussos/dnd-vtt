import { useEffect, useRef, useState, type FormEvent } from 'react';
import { insideShape, tokenCentre, type Region, type SceneToken } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Icon } from '../../ui/icons.js';
import { Menu } from '../../ui/Menu.js';
import { t } from '../../ui/messages.js';
import { TextField } from '../../ui/TextField.js';

// The scene's fog regions in the right-hand panel (TBL-03, specs/08-ux-journeys.md §11, the 2026-09-30 brief):
// each with whether it is fogged and how many tokens inside it players cannot see, a button that reveals or
// fogs it, and a menu to rename or delete it; "+" draws a new one with the fog tool. The count is of the
// tokens whose centre the region covers, the rule the server filters by: all of them while it is fogged,
// the hidden ones once it is revealed.

/** How many of the tokens inside the region players cannot see. */
export function hiddenInside(region: Region, tokens: readonly SceneToken[]): number {
  return tokens.filter(
    (token) => insideShape(tokenCentre(token, token.asset.size), region.shape) && (region.hidden || token.hidden),
  ).length;
}

/** The fogged region a token stands in, if any: the first drawn. */
export function fogOver(token: SceneToken, regions: readonly Region[]): Region | undefined {
  const centre = tokenCentre(token, token.asset.size);
  return regions.find((region) => region.hidden && insideShape(centre, region.shape));
}

const statusOf = (region: Region, count: number): string =>
  t(
    region.hidden
      ? count === 1
        ? 'fog.statusFogged.one'
        : 'fog.statusFogged.other'
      : count === 1
        ? 'fog.statusRevealed.one'
        : 'fog.statusRevealed.other',
    { count },
  );

export function RegionList({
  regions,
  tokens,
  onDraw,
  onToggle,
  onRename,
  onDelete,
}: {
  regions: readonly Region[];
  tokens: readonly SceneToken[];
  /** Absent while no region can be drawn. */
  onDraw?: (() => void) | undefined;
  onToggle: (region: Region) => void;
  onRename: (region: Region) => void;
  onDelete: (region: Region) => void;
}) {
  const heading = t('fog.heading', { count: regions.length });
  return (
    <section className="eg-token-list__group eg-regions" aria-label={heading}>
      <div className="eg-token-list__head">
        <h2 className="eg-token-list__heading">{heading}</h2>
        {onDraw ? (
          <button type="button" className="eg-icon-button" aria-label={t('fog.draw')} onClick={onDraw}>
            <Icon name="plus" />
          </button>
        ) : null}
      </div>
      {regions.length === 0 ? <p className="eg-regions__empty">{t('fog.none')}</p> : null}
      <ul className="eg-token-list__rows">
        {regions.map((region) => {
          const count = hiddenInside(region, tokens);
          return (
            <li
              key={region.id}
              className="eg-region-row"
              data-region={region.id}
              data-hidden={region.hidden || undefined}
            >
              <span className="eg-region-row__icon" aria-hidden="true">
                <Icon name="fog" size={17} />
              </span>
              <span className="eg-token-row__text">
                <span className="eg-token-row__name">{region.name}</span>
                <span className="eg-token-row__status">{statusOf(region, count)}</span>
              </span>
              <button
                type="button"
                className="eg-button eg-button--tiny"
                aria-label={t(region.hidden ? 'fog.revealOf' : 'fog.fogOf', { name: region.name })}
                onClick={() => onToggle(region)}
              >
                {t(region.hidden ? 'fog.reveal' : 'fog.fog')}
              </button>
              <Menu
                label={t('fog.moreOf', { name: region.name })}
                icon={<Icon name="more" />}
                className="eg-icon-button"
                items={[
                  { label: t('fog.rename'), onSelect: () => onRename(region) },
                  { label: t('fog.delete'), danger: true, onSelect: () => onDelete(region) },
                ]}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Names a region just drawn, or renames one; a name must have something besides white space. */
export function RegionNameDialog({
  heading,
  initial,
  save,
  onSave,
  onClose,
}: {
  heading: string;
  initial: string;
  save: string;
  /** Answers whether the name was taken; a refusal is said in the scene's status. */
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (trimmed === '') return setError(t('fog.nameRequired'));
    setSaving(true);
    const taken = await onSave(trimmed);
    setSaving(false);
    if (taken) onClose();
  }

  return (
    <Dialog heading={heading} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <TextField
          label={t('fog.name')}
          value={name}
          error={error}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
        />
        <div className="eg-dialog__actions">
          <Button type="submit" variant="primary" aria-disabled={saving || undefined}>
            {save}
          </Button>
          <Button onClick={onClose}>{t('fog.cancel')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks before deleting a region; the tokens it covered are seen again unless hidden. */
export function DeleteRegionDialog({
  region,
  onConfirm,
  onClose,
}: {
  region: Region;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <Dialog heading={t('fog.deleteHeading', { name: region.name })} onClose={onClose}>
      <p className="eg-dialog__body">{t(region.hidden ? 'fog.deleteBodyFogged' : 'fog.deleteBody')}</p>
      <div className="eg-dialog__actions">
        <Button variant="danger" onClick={onConfirm}>
          {t('fog.deleteConfirm')}
        </Button>
        <Button ref={keep} onClick={onClose}>
          {t('fog.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
