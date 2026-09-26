import { useEffect, useState } from 'react';
import { API_CONNECT_PATH, type ConnectInfo, type QrCode } from '@emberglass/shared';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Notice } from '../ui/Notice.js';
import { errorMessage } from '../ui/errorMessage.js';
import { t } from '../ui/messages.js';
import { errorCode, request } from './api.js';

// The "Connect a screen" panel (LIV-03, specs/08-ux-journeys.md §5, Q-026, Q-053, D-112): the
// player view's short URL to type into the TV's browser and its QR code, for the first
// private-range address of the server PC, then every other address in case the TV is on another
// network. The server lists them and encodes the code (GET /api/connect); nothing is fetched from
// outside the LAN, and the DM view's address never appears (specs/02-architecture.md §6).

// The quiet zone around the code, in modules, that a scanner needs.
const QUIET = 4;

/** The QR code as one SVG path, dark on light whatever the theme, so a phone can read it. */
export function QrImage({ qr, label }: { qr: QrCode; label: string }) {
  const side = qr.size + QUIET * 2;
  let path = '';
  qr.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '1') path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  });
  return (
    <svg
      className="eg-connect__qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      data-size={qr.size}
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<ConnectInfo>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    request<ConnectInfo>('GET', API_CONNECT_PATH).then(setInfo, (error: unknown) =>
      setFailure(errorMessage(errorCode(error))),
    );
  }, []);

  const [first, ...others] = info?.addresses ?? [];
  return (
    <Dialog heading={t('connect.heading')} onClose={onClose}>
      {failure ? <Notice>{failure}</Notice> : null}
      {!info && !failure ? (
        <p className="eg-dm__status" role="status">
          {t('connect.loading')}
        </p>
      ) : null}
      {info && !first ? <Notice>{t('connect.none')}</Notice> : null}
      {first ? (
        <div className="eg-dialog__body eg-connect">
          <p>{t('connect.intro')}</p>
          <p className="eg-connect__url" data-testid="connect-url">
            {first.url}
          </p>
          {info?.qr ? <QrImage qr={info.qr} label={t('connect.qrLabel', { url: first.url })} /> : null}
          {others.length > 0 ? (
            <>
              <h3 className="eg-connect__subheading">{t('connect.others')}</h3>
              <p className="eg-dm__status">{t('connect.othersHint')}</p>
              <ul className="eg-connect__others">
                {others.map((entry) => (
                  <li key={entry.address}>{entry.url}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="eg-dialog__actions">
        <Button onClick={onClose}>{t('connect.close')}</Button>
      </div>
    </Dialog>
  );
}
