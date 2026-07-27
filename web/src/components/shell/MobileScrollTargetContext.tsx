"use client";

import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useMemo,
  useReducer,
  useSyncExternalStore,
} from "react";

type MobileScrollTargetContextValue = {
  /** Register the page's primary scrollable element for "header double-tap to top". */
  setTarget: (el: HTMLElement | null) => void;
  /** Current target, if any. */
  target: HTMLElement | null;
};

const MobileScrollTargetContext = createContext<MobileScrollTargetContextValue>({
  setTarget: () => {},
  target: null,
});

function neverChangeSubscribe() {
  return () => {};
}

export function MobileScrollTargetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const targetRef = useRef<HTMLElement | null>(null);
  const [, forceRender] = useReducer((n) => n + 1, 0);

  const setTarget = useCallback((el: HTMLElement | null) => {
    targetRef.current = el;
    // Consumers reading `target` from the context value need the provider
    // (and therefore its descendants) to re-render when a target is attached.
    forceRender();
  }, []);

  const value = useMemo<MobileScrollTargetContextValue>(
    () => ({
      setTarget,
      get target() {
        return targetRef.current;
      },
    }),
    [setTarget],
  );

  return (
    <MobileScrollTargetContext.Provider value={value}>
      {children}
    </MobileScrollTargetContext.Provider>
  );
}

/** Returns a ref setter to attach to the primary scrollable element. */
export function useMobileScrollTarget() {
  const { setTarget } = useContext(MobileScrollTargetContext);
  return setTarget;
}

export function useMobileScrollTargetCurrent() {
  const context = useContext(MobileScrollTargetContext);
  // Subscribe to a dummy store. The provider re-renders when the target
  // changes, so this hook re-renders too and always reads the latest ref.
  useSyncExternalStore(
    neverChangeSubscribe,
    () => context.target,
    () => context.target,
  );
  return context.target;
}

export { MobileScrollTargetContext };
