export interface ConfiguratorAnalyticsEvent {
  name: string;
  timestamp: string;
  properties?: Record<string, unknown>;
}

declare global {
  interface Window {
    __MESHTOUR_CONFIGURATOR_EVENTS__?: ConfiguratorAnalyticsEvent[];
    __MESHTOUR_LAST_LEAD__?: unknown;
  }
}

export function track(name: string, properties?: Record<string, unknown>): void {
  const event = { name, timestamp: new Date().toISOString(), properties };
  window.__MESHTOUR_CONFIGURATOR_EVENTS__ ??= [];
  window.__MESHTOUR_CONFIGURATOR_EVENTS__.push(event);
  window.dispatchEvent(new CustomEvent("meshtour:analytics", { detail: event }));
}
