import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'> & {
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
};

// A native button, so Enter and Space operate it and it takes focus in order (D-069).
export function Button({ variant = 'secondary', type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`eg-button eg-button--${variant}`} />;
}
