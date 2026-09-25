import { useEffect, useState } from 'react';
import { Image as KonvaImage, Layer, Line, Stage } from 'react-konva';
import { imageFileUrl } from '@emberglass/shared';
import { cornerView, MAGNIFIER_PX, type Calibration } from '../../canvas/calibration.js';
import { CANVAS_COLOURS, type CanvasMap } from '../../canvas/MapCanvas.js';
import { t } from '../../ui/messages.js';

// The far corner of the map, magnified, with the grid being calibrated over it (PRP-03,
// specs/06-grid-and-measurement.md §1, D-094). It draws the original, the version meant for
// calibration (specs/05-assets-and-images.md §7), which only a DM session may fetch
// (specs/07-security-and-access.md §5); this component lives in the DM view alone and is
// mounted only while calibrating. Pixels are drawn unsmoothed, so a line a pixel off shows.

function useOriginal(id: string): { element?: HTMLImageElement; failed: boolean } {
  const [state, setState] = useState<{ id: string; element?: HTMLImageElement; failed: boolean }>();
  useEffect(() => {
    const element = new window.Image();
    element.onload = () => setState({ id, element, failed: false });
    element.onerror = () => setState({ id, failed: true });
    element.src = imageFileUrl(id, 'original');
    return () => {
      element.onload = null;
      element.onerror = null;
    };
  }, [id]);
  return state?.id === id ? state : { failed: false };
}

export function CornerMagnifier({ map, calibration }: { map: CanvasMap; calibration: Calibration }) {
  const original = useOriginal(map.id);
  const view = cornerView(calibration, { width: map.width, height: map.height });
  const segments = [
    ...view.xs.map((x) => ({ key: `x${x}`, axis: 'x', points: [x, 0, x, MAGNIFIER_PX] })),
    ...view.ys.map((y) => ({ key: `y${y}`, axis: 'y', points: [0, y, MAGNIFIER_PX, y] })),
  ];
  return (
    <figure className="eg-magnifier">
      <div
        className="eg-magnifier__box"
        role="img"
        aria-label={t('calibration.magnifier')}
        data-crop-x={view.crop.x}
        data-crop-y={view.crop.y}
        data-crop-side={view.crop.width}
        data-zoom={view.zoom}
      >
        <Stage width={MAGNIFIER_PX} height={MAGNIFIER_PX} listening={false}>
          <Layer listening={false} imageSmoothingEnabled={false}>
            {original.element ? (
              <KonvaImage
                name="corner"
                image={original.element}
                crop={view.crop}
                width={MAGNIFIER_PX}
                height={MAGNIFIER_PX}
              />
            ) : null}
          </Layer>
          <Layer listening={false}>
            {segments.map(({ key, points }) => (
              <Line
                key={`halo-${key}`}
                name="corner-halo"
                points={points}
                stroke={CANVAS_COLOURS.halo}
                strokeWidth={3}
              />
            ))}
            {segments.map(({ key, points, axis }) => (
              <Line
                key={key}
                name={`corner-line corner-line-${axis}`}
                points={points}
                stroke={CANVAS_COLOURS.grid}
                strokeWidth={1}
              />
            ))}
          </Layer>
        </Stage>
      </div>
      <figcaption className="eg-magnifier__caption">
        {original.failed ? t('calibration.magnifierFailed') : t('calibration.magnifierCaption')}
      </figcaption>
    </figure>
  );
}
