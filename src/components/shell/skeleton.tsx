import { Suspense, type ReactNode } from "react";

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden>
      <div className="h-10 w-56 rounded-lg bg-sunk" />
      <div className="h-44 rounded-[14px] bg-sunk" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-32 rounded-[14px] bg-sunk" />
        <div className="h-32 rounded-[14px] bg-sunk" />
      </div>
    </div>
  );
}

/**
 * Wrap a page's async body so the page itself renders instantly with a
 * placeholder and its live data streams in. Every screen behind sign-in reads
 * per-person, up-to-the-minute data, so every page is exported through this:
 *
 *   export default screen(async function SchedulePage(props) { ... })
 *
 * The boundary has to live inside the page (not in a layout above it) for
 * navigations between sibling screens to paint immediately.
 */
export function screen<P extends object>(Body: (props: P) => Promise<ReactNode> | ReactNode, fallback: ReactNode = <PageSkeleton />) {
  return function Screen(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Body {...props} />
      </Suspense>
    );
  };
}
