import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** What to show instead of a view that threw. It never receives the error. */
  fallback: ReactNode;
  children: ReactNode;
}

// The view-level error pattern (D-069): a view that throws while rendering is
// replaced by its fallback. The error's message and stack are never shown, so a
// failure cannot put internal detail on the DM's screen or the TV.
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // The browser console only; nothing is sent anywhere (specs/02-architecture.md §6).
    console.error(error, info.componentStack);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
