import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from 'react';
import { Icon, type IconName } from './icons.js';
import { useTooltip } from './Tooltip.js';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className' | 'children'> & {
  icon: IconName;
  /** The button's accessible name. */
  label: string;
  /** The short text shown as its tooltip; the label when not given. */
  tip?: string;
  danger?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

// A native button drawn as one icon (UXR-04), named by its label and showing its tip on hover and on
// keyboard focus, so a row of actions stays compact without losing what each one does.
export function IconButton({ icon, label, tip, danger = false, ...props }: IconButtonProps) {
  const { triggerProps, tooltip } = useTooltip(tip ?? label);
  return (
    <>
      <button
        {...props}
        {...triggerProps}
        type="button"
        aria-label={label}
        className={`eg-icon-button eg-icon-button--bordered${danger ? ' eg-icon-button--danger' : ''}`}
      >
        <Icon name={icon} size={15} />
      </button>
      {tooltip}
    </>
  );
}

type IconLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & {
  icon: IconName;
  label: string;
  tip?: string;
};

// The same, as a link: a download the browser saves, such as a campaign's export.
export function IconLink({ icon, label, tip, ...props }: IconLinkProps) {
  const { triggerProps, tooltip } = useTooltip(tip ?? label);
  return (
    <>
      <a {...props} {...triggerProps} aria-label={label} className="eg-icon-button eg-icon-button--bordered">
        <Icon name={icon} size={15} />
      </a>
      {tooltip}
    </>
  );
}
