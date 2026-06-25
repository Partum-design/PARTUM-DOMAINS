const CACHE_NAME = "partum-domains-cache-v3";
const DB_NAME = "partum-domains-vault";
const DB_VERSION = 2;
const META_STORE = "metadata";
const EVENT_STORE = "events";
const BACKUP_STORE = "backups";
const SETTINGS_STORE = "settings";
const META_KEY = "vault";
const BACKUP_SETTINGS_KEY = "backup-settings";
const BACKUP_SYNC_TAG = "partum-domains-backup";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/partum-icon.svg",
  "/logos/hostgator.svg",
  "/logos/godaddy.svg",
  "/logos/hostinger.svg",
  "/logos/siteground.svg",
  "/logos/namecheap.svg",
  "/logos/cloudflare.svg",
  "/logos/bluehost.svg",
  "/logos/ionos.svg",
  "/logos/wix.svg",
  "/logos/squarespace.svg",
  "/logos/wordpress.svg",
  "/logos/cpanel.svg",
  "/logos/kinsta.svg",
  "/logos/digitalocean.svg",
  "/logos/aws.svg",
  "/logos/shopify.svg",
  "/logos/webflow.svg",
  "/logos/vercel.svg",
  "/logos/netlify.svg",
  "/logos/render.svg",
  "/logos/firebase.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/") || caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }

        return response;
      });
    }),
  );
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "SHOW_NOTIFICATION") {
    return;
  }

  const { title, body, tag, url } = event.data;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url: url || "/" },
      icon: "/icons/partum-icon.svg",
      badge: "/icons/partum-icon.svg",
      vibrate: [120, 80, 120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});

const idbRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const openVaultDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }

      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        db.createObjectStore(EVENT_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const defaultBackupSettings = () => ({
  enabled: true,
  intervalDays: 15,
  lastRunAt: "",
  nextRunAt: new Date().toISOString(),
});

const getBackupPayload = async () => {
  const db = await openVaultDb();
  const tx = db.transaction([META_STORE, EVENT_STORE, SETTINGS_STORE], "readonly");
  const metadata = await idbRequest(tx.objectStore(META_STORE).get(META_KEY));
  const events = await idbRequest(tx.objectStore(EVENT_STORE).getAll());
  const settings =
    (await idbRequest(tx.objectStore(SETTINGS_STORE).get(BACKUP_SETTINGS_KEY))) ||
    defaultBackupSettings();
  await txDone(tx);
  db.close();
  return { metadata, events, settings };
};

const saveAutomaticBackup = async (reason) => {
  const { metadata, events, settings } = await getBackupPayload();

  if (!metadata || !events.length || !settings.enabled) {
    return null;
  }

  const now = new Date();
  const dueAt = settings.nextRunAt ? new Date(settings.nextRunAt) : now;

  if (Number.isFinite(dueAt.getTime()) && dueAt.getTime() > now.getTime()) {
    return null;
  }

  const backup = {
    app: "Partum Domains",
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    metadata,
    events,
  };
  const record = {
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    reason,
    eventCount: events.length,
    sizeBytes: new TextEncoder().encode(JSON.stringify(backup)).byteLength,
    backup,
  };
  const nextSettings = {
    ...settings,
    lastRunAt: record.createdAt,
    nextRunAt: addDays(now, settings.intervalDays).toISOString(),
  };
  const db = await openVaultDb();
  const tx = db.transaction([BACKUP_STORE, SETTINGS_STORE], "readwrite");
  tx.objectStore(BACKUP_STORE).add(record);
  tx.objectStore(SETTINGS_STORE).put(nextSettings, BACKUP_SETTINGS_KEY);
  await txDone(tx);
  db.close();
  return record;
};

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== BACKUP_SYNC_TAG) {
    return;
  }

  event.waitUntil(
    saveAutomaticBackup("periodic-sync").then((record) => {
      if (!record) {
        return undefined;
      }

      return self.registration.showNotification("Partum Domains", {
        body: "Backup cifrado automático creado. Conviene exportarlo a una ubicación externa.",
        tag: "partum-domains-auto-backup",
        data: { url: "/" },
        icon: "/icons/partum-icon.svg",
        badge: "/icons/partum-icon.svg",
      });
    }),
  );
});
