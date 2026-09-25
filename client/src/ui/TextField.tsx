import { useId, type InputHTMLAttributes } from 'react';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'aria-invalid'> & {
  label: string;
  error?: string | undefined;
};

// The field error pattern (D-069): a visible label, and when the value is refused,
// the reason next to the field, announced with it through aria-describedby.
export function TextField({ label, error, 'aria-describedby': describedBy, ...props }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  // A caller's description (a hint) is kept, and the error is announced after it.
  const described = [describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div className="eg-field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        className="eg-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
      />
      {error ? (
        <p id={errorId} className="eg-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
