const PREFIX = "[DisplayLink]";

function log(level, message, ...details) {
  const method = typeof console?.[level] === "function" ? console[level] : console.log;
  const normalizedMessage = typeof message === "string" ? message : String(message ?? "");
  const extras = details.filter((detail) => detail !== undefined);
  method.call(console, PREFIX, normalizedMessage, ...extras);
}

export function info(message, ...details) {
  log("info", message, ...details);
}

export function warn(message, ...details) {
  log("warn", message, ...details);
}

export function error(message, ...details) {
  log("error", message, ...details);
}
