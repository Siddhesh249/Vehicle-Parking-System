import { jest } from "@jest/globals";

// Test helper: a minimal stand-in for a socket.io-client socket that tracks its listeners.
export function fakeSocket() {
  const listeners = {};
  return {
    listeners,
    emitted: [],
    on: jest.fn((event, fn) => {
      (listeners[event] ??= []).push(fn);
    }),
    off: jest.fn(() => {
      for (const key of Object.keys(listeners)) delete listeners[key];
    }),
    emit: jest.fn(function emit(event, payload) {
      this.emitted.push([event, payload]);
    }),
    connect: jest.fn(),
    disconnect: jest.fn(),
    trigger(event, payload) {
      (listeners[event] ?? []).forEach((fn) => fn(payload));
    },
  };
}
