import { useEffect, useRef } from 'react';
import { FOG_BRUSH_RADIUS, inFog, tokenCentre, type FogMask, type SceneToken } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Icon } from '../../ui/icons.js';
import { formatNumber } from '../../canvas/calibration.js';
import { t } from '../../ui/messages.js';
import { Slider } from '../../ui/Slider.js';

// The scene's painted fog in the DM view (TBL-04, specs/04-live-sync.md §13, specs/08-ux-journeys.md §11,
// Q-101): in the right-hand panel, whether there is fog and how many tokens under it players cannot see,
// with a button that takes the brush; above the canvas while the brush is on, its bar: paint or erase, the
// brush's size, Fog all and Clear all, each asked first, and Done. The count is of the tokens whose centre
// the fog covers, the rule the server filters by.

/** Whether a token stands under the fog: its centre under a fogged cell. */
export const underFog = (token: SceneToken, fog: FogMask): boolean => inFog(tokenCentre(token, token.asset.size), fog);

export function FogPanel({
  fog,
  tokens,
  onPaint,
}: {
  fog: FogMask;
  tokens: readonly SceneToken[];
  /** Takes the brush; absent while it cannot be used. */
  onPaint?: (() => void) | undefined;
}) {
  const count = tokens.filter((token) => underFog(token, fog)).length;
  const status =
    fog.length === 0
      ? t('fog.status.none')
      : count === 0
        ? t('fog.status.clear')
        : t(count === 1 ? 'fog.status.one' : 'fog.status.other', { count });
  const heading = t('fog.heading');
  return (
    <section className="eg-token-list__group eg-fog" aria-label={heading}>
      <div className="eg-token-list__head">
        <h2 className="eg-token-list__heading">{heading}</h2>
      </div>
      <div className="eg-fog-row" data-fogged={fog.length > 0 || undefined}>
        <span className="eg-fog-row__icon" aria-hidden="true">
          <Icon name="fog" size={17} />
        </span>
        <span className="eg-token-row__text">
          <span className="eg-token-row__status">{status}</span>
        </span>
        {onPaint ? (
          <button type="button" className="eg-button eg-button--tiny" onClick={onPaint}>
            {t('fog.paintFog')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The brush's bar, above the canvas while the brush is on. */
export function FogBrushBar({
  erase,
  radius,
  onErase,
  onRadius,
  onFill,
  onClear,
  onDone,
}: {
  erase: boolean;
  radius: number;
  onErase: (erase: boolean) => void;
  onRadius: (radius: number) => void;
  onFill: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  return (
    <div
      className="eg-fog-bar"
      role="group"
      aria-label={t('fog.bar')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onDone();
        }
      }}
    >
      <span className="eg-fog-bar__modes">
        <Button size="small" aria-pressed={!erase} onClick={() => onErase(false)}>
          <Icon name="brush" size={15} />
          {t('fog.paint')}
        </Button>
        <Button size="small" aria-pressed={erase} onClick={() => onErase(true)}>
          <Icon name="eraser" size={15} />
          {t('fog.erase')}
        </Button>
      </span>
      <Slider
        label={t('fog.radius')}
        value={radius}
        min={FOG_BRUSH_RADIUS.min}
        max={FOG_BRUSH_RADIUS.max}
        step={FOG_BRUSH_RADIUS.step}
        valueText={t(radius === 1 ? 'fog.radiusValue.one' : 'fog.radiusValue.other', { radius: formatNumber(radius) })}
        onChange={onRadius}
      />
      <Button size="small" onClick={onFill}>
        {t('fog.fillAll')}
      </Button>
      <Button size="small" onClick={onClear}>
        {t('fog.clearAll')}
      </Button>
      <Button size="small" onClick={onDone}>
        {t('fog.done')}
      </Button>
    </div>
  );
}

/** Asks before fogging the whole map or clearing all its fog. */
export function FillFogDialog({
  fogged,
  live,
  onConfirm,
  onClose,
}: {
  fogged: boolean;
  /** On the live scene the change is undoable and players see it at once. */
  live: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  const body = fogged ? t(live ? 'fog.fillBody' : 'fog.fillBodyPrep') : t(live ? 'fog.clearBody' : 'fog.clearBodyPrep');
  return (
    <Dialog heading={t(fogged ? 'fog.fillHeading' : 'fog.clearHeading')} onClose={onClose}>
      <p className="eg-dialog__body">{body}</p>
      <div className="eg-dialog__actions">
        <Button variant={fogged ? 'primary' : 'danger'} onClick={onConfirm}>
          {t(fogged ? 'fog.fillConfirm' : 'fog.clearConfirm')}
        </Button>
        <Button ref={keep} onClick={onClose}>
          {t('fog.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
