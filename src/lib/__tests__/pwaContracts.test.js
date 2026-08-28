import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, test, vi } from "vitest";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "public", "manifest.webmanifest");
const WORKER_PATH = path.join(ROOT, "public", "sw.js");

function readPngSize(filePath) {
  const data = fs.readFileSync(filePath);
  expect(data.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function loadWorker({ fetchImpl = vi.fn() } = {}) {
  const listeners = {};
  const cache = {
    addAll: vi.fn(() => Promise.resolve()),
    put: vi.fn(() => Promise.resolve())
  };
  const caches = {
    open: vi.fn(() => Promise.resolve(cache)),
    keys: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve(true)),
    match: vi.fn(() => Promise.resolve(undefined))
  };
  const self = {
    location: { origin: "https://quotepilot.example" },
    addEventListener: vi.fn((type, listener) => { listeners[type] = listener; }),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() }
  };

  vm.runInNewContext(fs.readFileSync(WORKER_PATH, "utf8"), {
    URL,
    Promise,
    Set,
    caches,
    fetch: fetchImpl,
    self
  });

  return { cache, caches, fetchImpl, listeners, self };
}

function dispatch(listener, request) {
  let response;
  const background = [];
  listener({
    request,
    respondWith(value) { response = Promise.resolve(value); },
    waitUntil(value) { background.push(Promise.resolve(value)); }
  });
  return { background, response };
}

describe("PWA safe-shell contracts", () => {
  test("declares stable install identity and 192/512 maskable icons", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    expect(manifest).toMatchObject({
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      lang: "en-US"
    });
    expect(manifest.theme_color).toBe("#f4f4ef");

    const icons = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));
    for (const size of [192, 512]) {
      const icon = icons.get(`${size}x${size}`);
      expect(icon).toMatchObject({ type: "image/png", purpose: "any maskable" });
      expect(readPngSize(path.join(ROOT, "public", icon.src))).toEqual({
        width: size,
        height: size
      });
    }
  });

  test("pre-caches only the public recovery shell", async () => {
    const harness = loadWorker();
    let installation;
    harness.listeners.install({ waitUntil(value) { installation = value; } });
    await installation;

    expect(harness.cache.addAll).toHaveBeenCalledWith([
      "/offline.html",
      "/manifest.webmanifest",
      "/brand/quotepilot-mark.svg",
      "/brand/quotepilot-mark-192.png",
      "/brand/quotepilot-mark-512.png"
    ]);
    expect(harness.self.skipWaiting).toHaveBeenCalledOnce();
  });

  test("removes only older QuotePilot shell caches", async () => {
    const harness = loadWorker();
    harness.caches.keys.mockResolvedValue([
      "quotepilot-shell-v2",
      "quotepilot-shell-v3",
      "firebase-auth-cache",
      "unrelated-product-cache"
    ]);
    let activation;
    harness.listeners.activate({ waitUntil(value) { activation = value; } });
    await activation;

    expect(harness.caches.delete).toHaveBeenCalledTimes(1);
    expect(harness.caches.delete).toHaveBeenCalledWith("quotepilot-shell-v2");
    expect(harness.self.clients.claim).toHaveBeenCalledOnce();
  });

  test("falls back to the recovery document for offline navigation", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("offline")));
    const harness = loadWorker({ fetchImpl });
    const offlineDocument = { kind: "offline-document" };
    harness.caches.match.mockResolvedValue(offlineDocument);
    const event = dispatch(harness.listeners.fetch, {
      method: "GET",
      mode: "navigate",
      url: "https://quotepilot.example/app"
    });

    await expect(event.response).resolves.toBe(offlineDocument);
    expect(harness.caches.match).toHaveBeenCalledWith("/offline.html");
  });

  test("never caches application routes, API reads, or authenticated data", () => {
    const harness = loadWorker();
    for (const url of [
      "https://quotepilot.example/app/data.json",
      "https://quotepilot.example/api/quotes",
      "https://quotepilot.example/customerPortalQuotes/quote-1"
    ]) {
      const event = dispatch(harness.listeners.fetch, { method: "GET", mode: "cors", url });
      expect(event.response).toBeUndefined();
    }
    expect(harness.fetchImpl).not.toHaveBeenCalled();
    expect(harness.caches.match).not.toHaveBeenCalled();
  });

  test("caches successful public build assets but respects private responses", async () => {
    const publicResponse = {
      ok: true,
      type: "basic",
      headers: { get: () => "public, max-age=31536000, immutable" },
      clone: vi.fn(() => ({ kind: "asset-clone" }))
    };
    const harness = loadWorker({ fetchImpl: vi.fn(() => Promise.resolve(publicResponse)) });
    const request = {
      method: "GET",
      mode: "cors",
      url: "https://quotepilot.example/assets/workspace-abc123.js"
    };
    const event = dispatch(harness.listeners.fetch, request);
    await expect(event.response).resolves.toBe(publicResponse);
    expect(harness.cache.put).toHaveBeenCalledWith(request, { kind: "asset-clone" });

    harness.cache.put.mockClear();
    harness.fetchImpl.mockResolvedValue({
      ...publicResponse,
      headers: { get: () => "private, no-store" }
    });
    const privateEvent = dispatch(harness.listeners.fetch, request);
    await privateEvent.response;
    expect(harness.cache.put).not.toHaveBeenCalled();
  });
});
