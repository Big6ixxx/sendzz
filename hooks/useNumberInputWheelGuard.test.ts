// @vitest-environment jsdom
//
// Per-file rather than in vitest.config.ts: every other suite here is pure logic that runs
// faster in node, and switching the default would make them all pay for a DOM they never touch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNumberInputWheelGuard } from './useNumberInputWheelGuard';

/**
 * What these tests can and cannot show.
 *
 * jsdom has no layout and no native form-control behaviour, so it never steps a number input
 * on wheel in the first place — asserting "the value did not change" here would pass against
 * a guard that did nothing at all. What is actually checked is the mechanism: that the guard
 * blurs exactly the inputs it should and leaves the rest alone. That blurring suppresses the
 * step was confirmed separately against real Chrome, where the unguarded input went 100 -> 99
 * and the guarded one held at 100.
 */

let teardown: (() => void) | null = null;

function guard() {
  teardown = installNumberInputWheelGuard();
}

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function wheelOver(el: EventTarget) {
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
}

afterEach(() => {
  teardown?.();
  teardown = null;
  document.body.innerHTML = '';
});

describe('the number-input wheel guard', () => {
  it('blurs a focused number input, so the browser has nothing left to step', () => {
    const input = mount('<input type="number" value="100">') as HTMLInputElement;
    guard();
    input.focus();
    expect(document.activeElement).toBe(input);

    wheelOver(input);

    expect(document.activeElement).not.toBe(input);
  });

  it('leaves a number input nobody is typing in alone', () => {
    mount('<div><input type="number" value="100"><input type="text"></div>');
    const [number, text] = Array.from(document.querySelectorAll('input'));
    guard();
    text.focus();
    const blur = vi.spyOn(number, 'blur');

    wheelOver(number);

    /*
     * Asserted on the spy rather than on document.activeElement, which would pass either way:
     * blur() on an element that is not focused does nothing, in jsdom and in the browser both.
     * That also makes the activeElement check here defensive rather than load-bearing — it
     * keeps the guard from reaching for an input it has no business touching, and this pins
     * that intent so a later edit cannot quietly drop it.
     */
    expect(blur).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(text);
  });

  it('leaves the text-plus-inputMode amount fields alone', () => {
    // Hero, AmountConfig and MerchantApplicationCard spell their amounts this way. They were
    // never affected by wheel stepping, and a guard that blurred them would be a regression.
    const input = mount('<input type="text" inputmode="decimal" value="100">') as HTMLInputElement;
    guard();
    input.focus();

    wheelOver(input);

    expect(document.activeElement).toBe(input);
  });

  it('cannot be switched off by a handler further down the tree', () => {
    // The reason the listener is on document in the capture phase: anything an ancestor or the
    // input itself does with the event happens strictly later and cannot pre-empt it.
    const wrapper = mount('<div><input type="number" value="100"></div>');
    const input = wrapper.querySelector('input') as HTMLInputElement;
    wrapper.addEventListener('wheel', (e) => e.stopPropagation(), { capture: true });
    input.addEventListener('wheel', (e) => e.stopPropagation());
    guard();
    input.focus();

    wheelOver(input);

    expect(document.activeElement).not.toBe(input);
  });

  it('stops guarding once torn down', () => {
    const input = mount('<input type="number" value="100">') as HTMLInputElement;
    guard();
    teardown?.();
    teardown = null;
    input.focus();

    wheelOver(input);

    expect(document.activeElement).toBe(input);
  });

  it('shrugs off a wheel event with no element behind it', () => {
    guard();
    const blur = vi.spyOn(HTMLInputElement.prototype, 'blur');

    expect(() => wheelOver(document)).not.toThrow();
    expect(blur).not.toHaveBeenCalled();

    blur.mockRestore();
  });
});
