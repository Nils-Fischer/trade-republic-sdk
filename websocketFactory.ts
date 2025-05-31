import type { WebSocket as WsWebSocketType } from "ws";

// Common interface for WebSocket clients across environments
export interface IWebSocketClient {
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSING: number;
  readonly CLOSED: number;

  readonly readyState: number;
  readonly url: string;

  onopen: ((event: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

// Environment detection utilities
function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.node != null
  );
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.WebSocket !== "undefined";
}

// Wrapper for ws WebSocket to match our interface
class NodeWebSocketWrapper implements IWebSocketClient {
  private ws: WsWebSocketType;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  constructor(ws: WsWebSocketType) {
    this.ws = ws;
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  get url(): string {
    return this.ws.url;
  }

  get onopen(): ((event: any) => void) | null {
    return this.ws.onopen;
  }

  set onopen(handler: ((event: any) => void) | null) {
    this.ws.onopen = handler;
  }

  get onmessage(): ((event: any) => void) | null {
    return this.ws.onmessage;
  }

  set onmessage(handler: ((event: any) => void) | null) {
    this.ws.onmessage = handler;
  }

  get onerror(): ((event: any) => void) | null {
    return this.ws.onerror;
  }

  set onerror(handler: ((event: any) => void) | null) {
    this.ws.onerror = handler;
  }

  get onclose(): ((event: any) => void) | null {
    return this.ws.onclose;
  }

  set onclose(handler: ((event: any) => void) | null) {
    this.ws.onclose = handler;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }
}

// Browser WebSocket wrapper to match our interface
class BrowserWebSocketWrapper implements IWebSocketClient {
  private ws: WebSocket;

  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  get url(): string {
    return this.ws.url;
  }

  get onopen(): ((event: any) => void) | null {
    return this.ws.onopen;
  }

  set onopen(handler: ((event: any) => void) | null) {
    this.ws.onopen = handler;
  }

  get onmessage(): ((event: any) => void) | null {
    return this.ws.onmessage;
  }

  set onmessage(handler: ((event: any) => void) | null) {
    this.ws.onmessage = handler;
  }

  get onerror(): ((event: any) => void) | null {
    return this.ws.onerror;
  }

  set onerror(handler: ((event: any) => void) | null) {
    this.ws.onerror = handler;
  }

  get onclose(): ((event: any) => void) | null {
    return this.ws.onclose;
  }

  set onclose(handler: ((event: any) => void) | null) {
    this.ws.onclose = handler;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }
}

// Factory function to create appropriate WebSocket client
export async function createWebSocket(
  url: string,
  protocols?: string[],
  headers?: Record<string, string>,
): Promise<IWebSocketClient> {
  if (isNode()) {
    // Node.js or Bun environment
    try {
      const { WebSocket: WsWebSocket } = await import("ws");
      const options: any = {};

      if (headers) {
        options.headers = headers;
      }

      const ws = new WsWebSocket(url, protocols, options);
      return new NodeWebSocketWrapper(ws);
    } catch (error) {
      console.error(
        "WebSocket initialization failed in Node.js environment. " +
          "The 'ws' package is declared as a peer dependency for this SDK. " +
          "Please ensure it is installed in your project (e.g., 'npm install ws' or 'bun add ws').",
        error,
      );
      throw new Error("Required 'ws' module not found or failed to load.");
    }
  } else if (isBrowser()) {
    // Browser environment
    // Note: Browser WebSocket doesn't support custom headers in constructor
    // Headers would need to be handled differently (e.g., via URL params or initial message)
    const ws = new window.WebSocket(url, protocols);
    return new BrowserWebSocketWrapper(ws);
  } else {
    throw new Error("No WebSocket implementation found for this environment.");
  }
}
