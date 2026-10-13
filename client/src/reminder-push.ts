import type { ReminderPublicConfig } from './ReminderPanel';
import type { Messaging } from 'firebase/messaging';

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
type LocalDevice = { userId: string; subscriptionId: string; projectId: string };
const DEVICE_KEY = 'zabsync.push.device.v1';
let messaging: Messaging | null = null;
function currentDevice(): LocalDevice | null {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
  } catch {
    return null;
  }
}

/** User-gesture only: permission is never requested while signing in or loading a dashboard. */
export async function enableDevicePush(
  config: ReminderPublicConfig,
  userId: string,
  request: ApiRequest,
) {
  if (!config.pushAvailable || !config.publicFirebase || !config.vapidKey)
    throw new Error('Device notifications have not been configured.');
  if (!('Notification' in window) || !('serviceWorker' in navigator))
    throw new Error(
      'This browser does not support device notifications. You can still use the reminder inbox.',
    );
  // The permission call must stay ahead of asynchronous registration work on browsers requiring a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(
      'Notification permission was not granted. You can change it in your browser or phone settings.',
    );
  const [firebase, fcm] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await fcm.isSupported()))
    throw new Error(
      'This browser cannot receive these notifications. On iPhone, try the installed Home Screen app.',
    );
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active)
    throw new Error(
      'Install or refresh the built ZabSync app first so its service worker is ready.',
    );
  const name = `zabsync-push-${config.publicFirebase.projectId}`;
  const app =
    firebase.getApps().find((app) => app.name === name) ||
    firebase.initializeApp(config.publicFirebase, name);
  messaging = fcm.getMessaging(app);
  const instance = messaging;
  const installationId = await new Promise<string>((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Notification registration took too long. Please try again.'));
    }, 20_000);
    unsubscribe = fcm.onRegistered(instance, {
      next: (id) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(id);
      },
      error: (error) => {
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      },
      complete: () => {},
    });
    void fcm
      .register(instance, { vapidKey: config.vapidKey!, serviceWorkerRegistration: registration })
      .catch((error) => {
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      });
  });
  const deviceLabel = /iPhone|iPad/i.test(navigator.userAgent)
    ? 'Apple device'
    : /Android/i.test(navigator.userAgent)
      ? 'Android device'
      : 'Web browser';
  const saved = await request<{ id: string }>('/reminders/push-subscriptions', {
    method: 'POST',
    body: JSON.stringify({ installationId, deviceLabel }),
  });
  try {
    localStorage.setItem(
      DEVICE_KEY,
      JSON.stringify({
        userId,
        subscriptionId: saved.id,
        projectId: config.publicFirebase.projectId,
      } satisfies LocalDevice),
    );
  } catch {
    /* Server registration remains removable from the devices list. */
  }
  return saved;
}

export async function removeLocalPushRegistration(userId: string, subscriptionId: string) {
  const device = currentDevice();
  if (!device || device.userId !== userId || device.subscriptionId !== subscriptionId) return;
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* No local preference storage is required. */
  }
  if (messaging) {
    const fcm = await import('firebase/messaging');
    await fcm.unregister(messaging);
    messaging = null;
  } else if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
}

/** Call before explicit online logout. Removing this browser never disables the user's other devices. */
export async function disconnectPushOnLogout(userId: string, request: ApiRequest) {
  const device = currentDevice();
  if (!device || device.userId !== userId) return;
  try {
    await request(`/reminders/push-subscriptions/${device.subscriptionId}`, { method: 'DELETE' });
  } finally {
    await removeLocalPushRegistration(userId, device.subscriptionId);
  }
}
