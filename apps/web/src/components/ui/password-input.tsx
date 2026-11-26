'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { staffCopy } from '@/config/staff-copy';
import { cn } from '@/lib/utils';

/**
 * A password box with an eye button that shows or hides what was typed. Every password input of the
 * app uses it (sign in, forgot, reset, activate, change password, My profile). The button has a
 * label from the copy file, is reached with the keyboard (Tab, then Enter or Space) and says
 * whether the password is shown (aria-pressed).
 */
export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [shown, setShown] = useState(false);
    const copy = staffCopy.field;
    return (
      <span className="password-wrap">
        <input
          ref={ref}
          {...props}
          type={shown ? 'text' : 'password'}
          className={cn(className, 'password-input')}
        />
        <button
          type="button"
          className="password-eye"
          aria-label={shown ? copy.hidePassword : copy.showPassword}
          aria-pressed={shown}
          title={shown ? copy.hidePassword : copy.showPassword}
          onClick={() => setShown((value) => !value)}
        >
          <svg
            viewBox="0 0 24 24"
            width="100%"
            height="100%"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
            <circle cx="12" cy="12" r="3" />
            {shown ? null : <path d="M3 3l18 18" />}
          </svg>
        </button>
      </span>
    );
  },
);
