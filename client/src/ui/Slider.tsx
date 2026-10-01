import { useId, type InputHTMLAttributes } from 'react';

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'type' | 'onChange'> & {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** What the value means, shown beside the slider and read with it (`aria-valuetext`). */
  valueText: string;
  onChange: (value: number) => void;
};

// A labelled native range input (TBL-04, the fog brush's size): the keyboard, arrow keys, Home and End, and
// assistive technology come with it, and its value is said in words beside it.
export function Slider({ label, value, min, max, step, valueText, onChange, ...props }: SliderProps) {
  const id = useId();
  return (
    <div className="eg-slider">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        type="range"
        className="eg-slider__input"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id} className="eg-slider__value">
        {valueText}
      </output>
    </div>
  );
}
