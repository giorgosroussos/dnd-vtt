import type { ButtonHTMLAttributes, Ref } from 'react';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'> & {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'normal' | 'small';
  type?: 'button' | 'submit';
  // A prop in React 19, passed on to the button, for a caller that moves focus to it.
  ref?: Ref<HTMLButtonElement>;
};

// A native button, so Enter and Space operate it and it takes focus in order (D-069).
// `danger` is for the one button that confirms a permanent deletion; `small` for the
// per-item actions of a list (D-085).
export function Button({ variant = 'secondary', size = 'normal', type = 'button', ...props }: ButtonProps) {
  const sized = size === 'small' ? ' eg-button--small' : '';
  return <button {...props} type={type} className={`eg-button eg-button--${variant}${sized}`} />;
}
