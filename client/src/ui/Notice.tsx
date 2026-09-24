import type { ReactNode } from 'react';

// A page- or form-level error, announced when it appears (D-069).
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="eg-notice">
      {children}
    </div>
  );
}
