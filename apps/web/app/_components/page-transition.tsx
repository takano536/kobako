import * as React from 'react';

interface ViewTransitionProps {
  children?: React.ReactNode;
  name?: string;
  default?: string;
  enter?: string;
  exit?: string;
}

type ReactWithViewTransition = typeof React & {
  ViewTransition: React.ComponentType<ViewTransitionProps>;
};

// React 19.3 exports ViewTransition at runtime; @types/react 19.3 does not
// expose the canary declaration yet, so keep the cast local to this boundary.
const ViewTransition = (React as ReactWithViewTransition).ViewTransition;

export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ViewTransition name="page-content" enter="page-content-enter" exit="page-content-exit">
      <div data-slot="page-transition-content" className={className}>
        {children}
      </div>
    </ViewTransition>
  );
}
