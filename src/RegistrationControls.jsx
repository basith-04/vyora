import React from 'react';

export function FieldError({ id, error }) {
  return error ? <p className="registration-error" id={id} role="alert"><span aria-hidden="true">!</span> {error}</p> : null;
}

export function TextField({ field, label, placeholder, type = 'text', value, onChange, onBlur, error, inputRef, autoComplete, inputMode, prefix }) {
  const errorId = `${field}-error`;
  return <div className="registration-field"><label htmlFor={field}>{label} <span aria-hidden="true">*</span></label><div className={`registration-input-wrap${prefix ? ' has-prefix' : ''}`}>{prefix && <span className="registration-input-prefix" aria-hidden="true">{prefix}</span>}<input ref={inputRef} id={field} name={field} type={type} placeholder={placeholder} value={value ?? ''} onChange={onChange} onBlur={onBlur} autoComplete={autoComplete} inputMode={inputMode} required aria-invalid={!!error} aria-describedby={error ? errorId : undefined} /></div><FieldError id={errorId} error={error} /></div>;
}

export function RadioChoice({ field, legend, value, onChange, onBlur, error, inputRef, options }) {
  return <fieldset className="registration-choice-fieldset"><legend>{legend} <span aria-hidden="true">*</span></legend><div className="registration-ieee-grid">{options.map((option, index) => <label className={`registration-ieee-option registration-accommodation-option${value === option.value ? ' is-selected' : ''}`} key={option.label}><input ref={index === 0 ? inputRef : undefined} type="radio" name={field} required value={option.label} checked={value === option.value} onChange={() => onChange(field, option.value)} onBlur={() => onBlur?.(field)} aria-invalid={!!error} aria-describedby={error ? `${field}-error` : undefined} /><span className="registration-radio-mark" aria-hidden="true" /><strong>{option.label}</strong></label>)}</div><FieldError id={`${field}-error`} error={error} /></fieldset>;
}

export function YesNoChoice(props) { return <RadioChoice {...props} options={[{ label: 'YES', value: true }, { label: 'NO', value: false }]} />; }
