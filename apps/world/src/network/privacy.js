// Deep scan for private data that must never appear on the realtime wire.
// Packets are built from allowlists (protocol.js); this is the independent check used by tests
// and by NetworkManager before presence leaves the client.

const FORBIDDEN_KEY = /^(e_?mail|mail|password|passwd|token|access_?token|refresh_?token|id_?token|provider_?token|jwt|authorization|auth|credentials?|session_?token|phone(_?number)?|student_?id|real_?name|birth(day|date)?|address|ip|user_?metadata|app_?metadata)$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

export function findPrivateDataViolations(value, path = "$", found = []) {
  if (typeof value === "string") {
    if (EMAIL.test(value)) found.push(`${path}: email-like value`);
    if (JWT.test(value)) found.push(`${path}: JWT-like value`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findPrivateDataViolations(item, `${path}[${index}]`, found));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) found.push(`${path}.${key}: forbidden key`);
      findPrivateDataViolations(item, `${path}.${key}`, found);
    }
  }
  return found;
}

export function isPublicPacket(value) {
  return findPrivateDataViolations(value).length === 0;
}
