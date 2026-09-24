import type { MouseEvent } from 'react';

// The first stop of the Tab order: moves keyboard focus past the banner to the
// main content (D-069). Focus is moved explicitly so that it lands on the
// target in every browser, whatever it does with fragment navigation.
export function SkipLink({ targetId, label }: { targetId: string; label: string }) {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
  return (
    <a className="eg-skip-link" href={`#${targetId}`} onClick={skip}>
      {label}
    </a>
  );
}
