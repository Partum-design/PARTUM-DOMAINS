import type { DomainRecord } from "./types";
import { daysUntil, getCriticalDate } from "./utils";

const NOTIFICATION_KEY_PREFIX = "partum-domains-notified";

export const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  return navigator.serviceWorker.register("/sw.js");
};

export const requestNotificationPermission = async () => {
  if (!("Notification" in window)) {
    return "unsupported" as const;
  }

  if (Notification.permission === "granted") {
    return "granted" as const;
  }

  return Notification.requestPermission();
};

export const showLocalNotification = async (title: string, body: string, tag: string) => {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const registration = await navigator.serviceWorker?.ready.catch(() => null);

  if (registration?.active) {
    registration.active.postMessage({
      type: "SHOW_NOTIFICATION",
      title,
      body,
      tag,
      url: "/",
    });
    return true;
  }

  new Notification(title, { body, tag, icon: "/icons/partum-icon.svg" });
  return true;
};

export const notifyExpiringDomains = async (records: DomainRecord[]) => {
  const today = new Date().toISOString().slice(0, 10);
  const visibleRecords = records.filter((record) => !record.archived);
  const urgentRecords = visibleRecords.filter((record) => {
    const days = daysUntil(getCriticalDate(record));
    return days !== null && days <= 30;
  });

  if (urgentRecords.length === 0) {
    return;
  }

  const key = `${NOTIFICATION_KEY_PREFIX}:${today}`;

  if (localStorage.getItem(key)) {
    return;
  }

  const expired = urgentRecords.filter((record) => {
    const days = daysUntil(getCriticalDate(record));
    return days !== null && days < 0;
  });
  const expiring = urgentRecords.length - expired.length;

  const pieces = [
    expired.length ? `${expired.length} vencido${expired.length === 1 ? "" : "s"}` : "",
    expiring ? `${expiring} por vencer` : "",
  ].filter(Boolean);

  await showLocalNotification(
    "Partum Domains",
    `Tienes ${pieces.join(" y ")} en los próximos 30 días.`,
    "partum-domains-expiration",
  );
  localStorage.setItem(key, "1");
};
