const LOCATION_API_UNAVAILABLE_WARNING =
  "Window location API is not available; navigation was skipped.";

function replaceLocation(target) {
  if (typeof window === "undefined" || !window?.location) {
    console.warn(LOCATION_API_UNAVAILABLE_WARNING, { target });
    return;
  }
  window.location.replace(target);
}

export const LOGIN_PAGE = "login.html";
export const EVENTS_PAGE = "index.html";

export function goToLogin() {
  replaceLocation(LOGIN_PAGE);
}

export function goToEvents() {
  replaceLocation(EVENTS_PAGE);
}

export function redirectTo(target) {
  replaceLocation(target);
}
