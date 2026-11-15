import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as webpush from "web-push";
import {
  devicePushError,
  enableDevicePush,
  getDevicePushSupport,
  pushKeyBytes,
} from "../src/lib/push-client";

const publicKey = webpush.generateVAPIDKeys().publicKey;
function browser(
  t: TestContext,
  options: {
    ios?: boolean;
    ipadDesktop?: boolean;
    installed?: boolean;
    permission?: NotificationPermission;
    result?: NotificationPermission;
    existing?: boolean;
    oldKey?: string;
    missingRegistration?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const notification = {
    permission: options.permission ?? "default",
    requestPermission: async () => {
      calls.push("permission");
      return options.result ?? "granted";
    },
  };
  const subscription = {
    options: {
      applicationServerKey: pushKeyBytes(options.oldKey ?? publicKey).buffer,
    },
    unsubscribe: async () => {
      calls.push("unsubscribe");
      return true;
    },
    toJSON: () => ({
      endpoint: "https://web.push.apple.com/test",
      keys: { auth: "test", p256dh: "test" },
    }),
  } as unknown as PushSubscription;
  const registration = {
    pushManager: {
      getSubscription: async () => {
        calls.push("getSubscription");
        return options.existing ? subscription : null;
      },
      subscribe: async (input: PushSubscriptionOptionsInit) => {
        calls.push("subscribe");
        assert.equal(input.userVisibleOnly, true);
        assert.deepEqual(input.applicationServerKey, pushKeyBytes(publicKey));
        return subscription;
      },
    },
  };
  const nav = {
    userAgent: options.ios
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
      : "Chrome",
    platform: options.ipadDesktop ? "MacIntel" : "Win32",
    maxTouchPoints: options.ipadDesktop ? 5 : 0,
    standalone: options.installed ?? true,
    serviceWorker: {
      getRegistration: async () => {
        calls.push("getRegistration");
        return options.missingRegistration ? undefined : registration;
      },
      register: async (url: string) => {
        calls.push("register");
        assert.equal(url, "/sw.js");
        return registration;
      },
      ready: Promise.resolve(registration),
    },
  };
  const win = {
    isSecureContext: true,
    PushManager: class {},
    Notification: notification,
    matchMedia: () => ({ matches: options.installed ?? true }),
  };
  for (const [name, value] of Object.entries({
    window: win,
    navigator: nav,
    Notification: notification,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { calls, nav, win, registration, subscription };
}

test("iPhone and desktop-mode iPad explain Home Screen installation without requesting permission", async (t) => {
  const env = browser(t, { ios: true, installed: false });
  assert.equal(getDevicePushSupport(publicKey).kind, "install");
  await assert.rejects(enableDevicePush(publicKey), /Màn hình chính/);
  assert.deepEqual(env.calls, []);
  env.nav.userAgent = "Macintosh";
  env.nav.platform = "MacIntel";
  env.nav.maxTouchPoints = 5;
  assert.equal(getDevicePushSupport(publicKey).kind, "install");
});
test("installed iPhone requests permission synchronously from the tap, then registers and subscribes", async (t) => {
  const env = browser(t, {
    ios: true,
    installed: true,
    missingRegistration: true,
  });
  const pending = enableDevicePush(publicKey);
  assert.deepEqual(env.calls, ["permission"]);
  assert.equal(await pending, env.subscription);
  assert.deepEqual(env.calls, [
    "permission",
    "getRegistration",
    "register",
    "getSubscription",
    "subscribe",
  ]);
});
test("missing server config, insecure context and blocked permission remain distinct", async (t) => {
  const env = browser(t);
  assert.equal(getDevicePushSupport("").kind, "unconfigured");
  env.win.isSecureContext = false;
  assert.equal(getDevicePushSupport(publicKey).kind, "insecure");
  env.win.isSecureContext = true;
  env.win.Notification.permission = "denied";
  assert.equal(getDevicePushSupport(publicKey).kind, "denied");
  await assert.rejects(enableDevicePush(publicKey), /cài đặt/);
  assert.deepEqual(env.calls, []);
});
test("a dismissed or rejected permission request never creates a device subscription", async (t) => {
  const env = browser(t, { result: "default" });
  await assert.rejects(enableDevicePush(publicKey), /Chưa bật/);
  assert.deepEqual(env.calls, ["permission"]);
});
test("retry after a failed server save reuses the subscription without prompting again", async (t) => {
  const env = browser(t, { permission: "granted", existing: true });
  assert.equal(await enableDevicePush(publicKey), env.subscription);
  assert.deepEqual(env.calls, ["getRegistration", "getSubscription"]);
});
test("a subscription from an old VAPID key is replaced once", async (t) => {
  const env = browser(t, {
    permission: "granted",
    existing: true,
    oldKey: webpush.generateVAPIDKeys().publicKey,
  });
  await enableDevicePush(publicKey);
  assert.deepEqual(env.calls, [
    "getRegistration",
    "getSubscription",
    "unsubscribe",
    "subscribe",
  ]);
});
test("browser push and network failures produce actionable messages", () => {
  assert.match(
    devicePushError(new DOMException("no", "NotAllowedError")),
    /cài đặt/,
  );
  assert.match(
    devicePushError(new DOMException("offline", "AbortError")),
    /Kiểm tra mạng/,
  );
  assert.throws(() => pushKeyBytes("invalid"), /chưa hợp lệ/);
});
