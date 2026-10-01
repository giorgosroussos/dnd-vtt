import { useEffect, useId, useRef, type ReactNode } from 'react';

// A native modal dialog (D-085): opened with showModal() when it mounts, so the
// browser keeps focus inside it and makes the page behind it inert; Escape asks
// the owner to close it. Its heading names it for assistive technology. When it
// goes, focus returns to what had it before it opened: the owner cannot do that
// itself while the dialog is still open, since the page behind is inert until
// then (REL-01 review U-H1). An owner that wants focus elsewhere moves it in an
// effect, which runs after this.
export function Dialog({
  heading,
  onClose,
  className,
  children,
}: {
  heading: string;
  onClose: () => void;
  /** Added to `eg-dialog`, for a dialog laid out its own way. */
  className?: string | undefined;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      if (element.open) element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={className ? `eg-dialog ${className}` : 'eg-dialog'}
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
