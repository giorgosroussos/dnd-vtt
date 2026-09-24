import { useEffect, useId, useRef, type ReactNode } from 'react';

// A native modal dialog (D-085): opened with showModal() when it mounts, so the
// browser keeps focus inside it and makes the page behind it inert; Escape asks
// the owner to close it. Its heading names it for assistive technology.
export function Dialog({ heading, onClose, children }: { heading: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="eg-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={headingId} className="eg-dialog__heading">
        {heading}
      </h2>
      {children}
    </dialog>
  );
}
