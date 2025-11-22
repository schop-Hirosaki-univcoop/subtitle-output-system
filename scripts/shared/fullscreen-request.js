// fullscreen-request.js: ログイン後に1回だけフルスクリーン化を試みるためのフラグを管理します。

const FULLSCREEN_REQUEST_KEY = "events:launch-fullscreen";

function getSessionStorage() {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.sessionStorage || null;
  } catch (error) {
    console.warn("Session storage is not available", error);
    return null;
  }
}

export function markLaunchFullscreenRequest() {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  storage.setItem(FULLSCREEN_REQUEST_KEY, "1");
}

export function consumeLaunchFullscreenRequest() {
  const storage = getSessionStorage();
  if (!storage) {
    return false;
  }
  const value = storage.getItem(FULLSCREEN_REQUEST_KEY);
  if (value === null) {
    return false;
  }
  storage.removeItem(FULLSCREEN_REQUEST_KEY);
  return value === "1";
}
