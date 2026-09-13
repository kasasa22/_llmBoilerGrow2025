type Listener = (event: MessageEvent) => void;

export interface MockEventSource {
  url: string;
  listeners: Map<string, Set<Listener>>;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  closed: boolean;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  emit(phase: string, envelope: Record<string, unknown>): void;
  triggerOpen(): void;
  triggerError(): void;
  close(): void;
}

const registry: MockEventSource[] = [];

function createMockEventSource(url: string): MockEventSource {
  const listeners = new Map<string, Set<Listener>>();
  const instance: MockEventSource = {
    url,
    listeners,
    onopen: null,
    onerror: null,
    closed: false,
    addEventListener(type, listener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set<Listener>();
        listeners.set(type, set);
      }
      set.add(listener as Listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener as Listener);
    },
    emit(phase, envelope) {
      const event = new MessageEvent(phase, { data: JSON.stringify(envelope) });
      listeners.get(phase)?.forEach((l) => l(event));
    },
    triggerOpen() {
      instance.onopen?.();
    },
    triggerError() {
      instance.onerror?.();
    },
    close() {
      instance.closed = true;
    },
  };
  registry.push(instance);
  return instance;
}

const MockEventSourceCtor = function EventSource(this: unknown, url: string) {
  return createMockEventSource(url);
} as unknown as new (url: string) => MockEventSource;

export const mockEventSourceRegistry = {
  get instances(): MockEventSource[] {
    return registry;
  },
  reset(): void {
    registry.length = 0;
  },
};

export function installMockEventSource(): typeof mockEventSourceRegistry {
  mockEventSourceRegistry.reset();
  Object.defineProperty(globalThis, 'EventSource', {
    value: MockEventSourceCtor,
    writable: true,
    configurable: true,
  });
  return mockEventSourceRegistry;
}
