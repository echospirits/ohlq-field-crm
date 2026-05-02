'use client';

import { type InputHTMLAttributes, useRef } from 'react';

type DateInputElement = HTMLInputElement & {
  showPicker?: () => void;
};

type DatePickerFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  pickerLabel?: string;
};

export function DatePickerField({ className, pickerLabel = 'Choose date', ...inputProps }: DatePickerFieldProps) {
  const inputRef = useRef<DateInputElement>(null);
  const wrapperClassName = ['date-picker-field', className].filter(Boolean).join(' ');

  const openPicker = () => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }

    input.focus();
    input.click();
  };

  return (
    <div className={wrapperClassName}>
      <input {...inputProps} ref={inputRef} type="date" />
      <button aria-label={pickerLabel} className="date-picker-button" type="button" onClick={openPicker}>
        <span aria-hidden="true" className="date-picker-icon" />
      </button>
    </div>
  );
}
