import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
// jsdom lacks native dialog methods; Chrome supplies these in the actual UI.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});
