import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { API_ARCHIVE_PATHS, type ImportProgress, type ImportSummary } from '@emberglass/shared';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { t, type MessageKey } from '../../ui/messages.js';
import { ApiError, errorCode, request, uploadArchive } from '../api.js';

// Import (DMT-05; specs/08-ux-journeys.md §13, specs/09-operations.md §9, Q-115): the DM chooses an Emberglass export,
// a campaign or library assets, and the server checks it all before storing anything. While it runs the dialog shows
// the upload's progress, then the stage the server is at, read from GET /api/import/progress, its images counted; at
// the end, what it added and what it reused, or why it was refused and that nothing changed. The dialog cannot be
// closed while the import runs: closing would not stop it on the server. An import touches no live state, so it is
// offered while a scene is live too.

/** How often the dialog asks the server how far the import got. */
export const PROGRESS_POLL_MS = 400;

type State =
  | { kind: 'choosing' }
  | { kind: 'running'; sent: number; server: ImportProgress | undefined }
  | { kind: 'done'; summary: ImportSummary }
  | { kind: 'refused'; reason: string; detail: string | undefined };

const plural = (key: string, count: number, params: Record<string, number | string> = {}): string =>
  t(`${key}.${count === 1 ? 'one' : 'other'}` as MessageKey, { count, ...params });

/** What the import added and reused, in a line (specs/08-ux-journeys.md §13). */
export function summaryText(summary: ImportSummary): string {
  const assets = plural('import.summary.assets', summary.assets.added, { reused: summary.assets.reused });
  const images = plural('import.summary.images', summary.images.reused, { added: summary.images.added });
  if (summary.campaign === null) return t('import.summary.library', { assets, images });
  return t('import.summary.campaign', {
    name: summary.campaign.name,
    sessions: plural('import.summary.sessions', summary.sessions),
    scenes: plural('import.summary.scenes', summary.scenes),
    tokens: plural('import.summary.tokens', summary.tokens),
    assets,
    images,
  });
}

/** Why an import was refused, in the DM's words. */
export function refusalText(error: unknown): string {
  const code = errorCode(error);
  if (code === 'import_newer_format' && error instanceof ApiError && error.formatVersion !== undefined) {
    return t('import.refused.newer', { version: error.formatVersion });
  }
  return errorMessage(code);
}

function stageText(state: Extract<State, { kind: 'running' }>): string {
  const { server } = state;
  if (state.sent < 1 || !server || server.stage === 'receiving' || server.stage === null) {
    return t('import.stage.uploading', { percent: Math.floor(state.sent * 100) });
  }
  if (server.stage === 'images') {
    return t('import.stage.images', { done: server.done, total: server.total });
  }
  return t(server.stage === 'reading' ? 'import.stage.reading' : 'import.stage.saving');
}

/** The fraction a progress bar shows: the upload, then the images; undefined while there is nothing to count. */
function fraction(state: Extract<State, { kind: 'running' }>): number | undefined {
  if (state.sent < 1) return state.sent;
  const { server } = state;
  if (server?.stage === 'images' && server.total > 0) return server.done / server.total;
  return undefined;
}

export function ImportDialog({
  onImported,
  onClose,
}: {
  onImported: (summary: ImportSummary) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const [file, setFile] = useState<File>();
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<State>({ kind: 'choosing' });
  const closeButton = useRef<HTMLButtonElement>(null);
  const running = state.kind === 'running';

  // While it runs, the server's stage, read until the answer comes.
  useEffect(() => {
    if (!running) return;
    let active = true;
    const read = () =>
      request<ImportProgress>('GET', API_ARCHIVE_PATHS.importProgress).then(
        (server) => {
          if (active) setState((current) => (current.kind === 'running' ? { ...current, server } : current));
        },
        () => {},
      );
    const timer = setInterval(() => void read(), PROGRESS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [running]);

  // The outcome is read out, and the keyboard goes to Close.
  useEffect(() => {
    if (state.kind === 'done' || state.kind === 'refused') closeButton.current?.focus();
  }, [state.kind]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (running) return;
    if (!file) return setMissing(true);
    setState({ kind: 'running', sent: 0, server: undefined });
    try {
      const summary = await uploadArchive(file, (sent) =>
        setState((current) => (current.kind === 'running' ? { ...current, sent } : current)),
      );
      setState({ kind: 'done', summary });
      onImported(summary);
    } catch (error) {
      const detail = error instanceof ApiError ? error.details[0]?.message : undefined;
      setState({ kind: 'refused', reason: refusalText(error), detail });
    }
  }

  const progress = running ? fraction(state) : undefined;
  return (
    <Dialog heading={t('import.heading')} onClose={running ? () => {} : onClose} className="eg-import">
      {state.kind === 'done' ? (
        <p className="eg-import__summary" role="status">
          {summaryText(state.summary)}
        </p>
      ) : state.kind === 'refused' ? (
        <div className="eg-notice" role="alert">
          <p>{state.reason}</p>
          <p>{t('import.refused.nothingChanged')}</p>
          {state.detail ? (
            <p className="eg-import__detail">{t('import.refused.detail', { detail: state.detail })}</p>
          ) : null}
        </div>
      ) : (
        <form
          id={`${ids}-form`}
          className="eg-form"
          onSubmit={(event) => void start(event)}
          noValidate
          aria-busy={running || undefined}
        >
          <p className="eg-dm__status">{t('import.intro')}</p>
          <div className="eg-field">
            <label htmlFor={`${ids}-file`}>{t('import.file')}</label>
            <input
              id={`${ids}-file`}
              className="eg-field__input"
              type="file"
              accept=".zip,application/zip"
              disabled={running}
              aria-invalid={missing || undefined}
              aria-describedby={missing ? `${ids}-missing` : undefined}
              onChange={(event) => {
                setFile(event.target.files?.[0]);
                setMissing(false);
              }}
            />
            {missing ? (
              <p id={`${ids}-missing`} className="eg-field__error">
                {t('import.fileRequired')}
              </p>
            ) : null}
          </div>
          <div className="eg-import__progress" role="status">
            {running ? (
              <>
                <span>{stageText(state)}</span>
                <progress max={1} value={progress} aria-label={t('import.progress')} />
              </>
            ) : null}
          </div>
        </form>
      )}
      <div className="eg-dialog__actions">
        {state.kind === 'choosing' || running ? (
          <>
            <Button onClick={onClose} aria-disabled={running || undefined} disabled={running}>
              {t('import.cancel')}
            </Button>
            <Button type="submit" form={`${ids}-form`} variant="primary" aria-disabled={running || undefined}>
              {t('import.start')}
            </Button>
          </>
        ) : (
          <Button ref={closeButton} variant="primary" onClick={onClose}>
            {t('import.close')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
