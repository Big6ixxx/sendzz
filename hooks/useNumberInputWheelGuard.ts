'use client';

import { useEffect } from 'react';

/**
 * Installs the guard and returns the function that removes it again.
 *
 * Split out from the hook so it can be tested without a React renderer — the whole of the
 * behaviour lives here, and the hook below is only the lifecycle around it.
 */
export function installNumberInputWheelGuard(): () => void {
  const onWheel = (event: WheelEvent) => {
    const el = event.target;
    if (el instanceof HTMLInputElement && el.type === 'number' && el === document.activeElement) {
      el.blur();
    }
  };

  // Capture phase, so a component's own onWheel handler cannot stop propagation and quietly
  // opt itself back into the stepping. Passive: nothing here calls preventDefault.
  document.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return () => document.removeEventListener('wheel', onWheel, { capture: true });
}

/**
 * Stops the mouse wheel from changing the value of a focused `<input type="number">`.
 *
 * Browsers treat a wheel tick over a focused number input as a step up or down. On an amount
 * field that silently rewrites what someone is about to send: they tab into the amount, scroll
 * the page to reach the button, and the figure moves with no sign it happened.
 *
 * Blurring the input while the event is still being dispatched is what kills it. The step is a
 * default action, applied after dispatch finishes and only to the focused element, so by the
 * time the browser gets there the input no longer qualifies. Calling preventDefault() would
 * also work, but it would swallow the scroll itself and strand the page whenever the pointer
 * happened to rest over an amount field. Losing focus is the cheaper of the two.
 *
 * Registered once for the whole app rather than per input, so a number field added later is
 * covered without anyone having to remember to opt in.
 */
export function useNumberInputWheelGuard() {
  useEffect(installNumberInputWheelGuard, []);
}
