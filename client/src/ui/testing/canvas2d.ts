// Test tooling only, never bundled: jsdom implements no 2D canvas context, which
// Konva needs to build a stage (D-006). This gives every canvas a context that
// accepts every call and draws nothing, so the component tests can render the
// real react-konva tree and read its nodes; what the map looks like drawn is the
// end-to-end tests' (e2e/tests/canvas.spec.ts).
export function installCanvas2d(): void {
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & { egStubbed?: boolean };
  if (proto.egStubbed) return;
  proto.egStubbed = true;
  const contexts = new WeakMap<HTMLCanvasElement, object>();
  const noop = () => undefined;
  const make = (canvas: HTMLCanvasElement) => {
    const state: Record<string | symbol, unknown> = { canvas };
    return new Proxy(state, {
      get: (target, key) => {
        if (key in target) return target[key];
        if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
        if (key === 'getImageData' || key === 'createImageData') {
          return (...size: number[]) => ({ data: new Uint8ClampedArray(4 * (size[2] ?? 1) * (size[3] ?? 1)) });
        }
        if (key === 'getLineDash') return () => [];
        if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') {
          return () => ({ addColorStop: noop });
        }
        return noop;
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    });
  };
  proto.getContext = function getContext(this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (!context) {
      context = make(this);
      contexts.set(this, context);
    }
    return context;
  } as typeof proto.getContext;
  proto.toDataURL = () => 'data:,';
}

/** jsdom lays nothing out: every observed element reports `size` as its content box. */
export function installResizeObserver(size: { width: number; height: number }): void {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      const entry = {
        target,
        contentRect: { ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height },
      };
      queueMicrotask(() => this.callback([entry as unknown as ResizeObserverEntry], this));
    }
    unobserve(): void {}
    disconnect(): void {}
  };
}

/**
 * jsdom fetches no image. Every URL an image element is given is recorded in `requested`,
 * and the element then reports that it loaded, or failed when the URL is in `failing`; a URL in
 * `held` never reports, as an image still on its way.
 */
export const images = { requested: [] as string[], failing: new Set<string>(), held: new Set<string>() };
export function installImageLoading(): void {
  images.requested = [];
  images.failing = new Set();
  images.held = new Set();
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.getAttribute('src') ?? '';
    },
    set(this: HTMLImageElement, value: string) {
      this.setAttribute('src', value);
      images.requested.push(value);
      if (images.held.has(value)) return;
      const failed = images.failing.has(value);
      setTimeout(() => this.dispatchEvent(new Event(failed ? 'error' : 'load')), 0);
    },
  });
}
