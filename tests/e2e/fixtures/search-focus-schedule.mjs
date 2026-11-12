// Delay the exact native focus call used by the recovered palette. This exposes
// the race structurally, without timers or access to private application state.
export async function holdLegacySearchFocus(page) {
  await page.addInitScript(() => {
    const nativeFocus = HTMLElement.prototype.focus;
    const gate = { pending: [], held: 0 };
    HTMLElement.prototype.focus = function (...args) {
      if (this.id === 'search-input') {
        gate.held++;
        gate.pending.push(() => Reflect.apply(nativeFocus, this, args));
        return;
      }
      return Reflect.apply(nativeFocus, this, args);
    };
    window.__erLegacyFocusGate = {
      held: () => gate.held,
      release() {
        HTMLElement.prototype.focus = nativeFocus;
        for (const focus of gate.pending.splice(0)) focus();
      }
    };
  });
}

export const heldLegacyFocusCount = page => page.evaluate(() => window.__erLegacyFocusGate.held());
export const releaseLegacySearchFocus = page => page.evaluate(() => window.__erLegacyFocusGate.release());
