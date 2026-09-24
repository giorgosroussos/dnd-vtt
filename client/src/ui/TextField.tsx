import { useId, type InputHTMLAttributes } from 'react';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'aria-invalid'> & {
  label: string;
  error?: string;
};

// The field error pattern (D-069): a visible label, and when the value is refused,
// the reason next to the field, announced with it through aria-describedby.
export function TextField({ label, error, ...props }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="eg-field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        className="eg-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className="eg-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
