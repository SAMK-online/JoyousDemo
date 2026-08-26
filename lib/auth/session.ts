export type AppRole = "patient" | "product";

export const SESSION_COOKIE = "joyous_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;

interface SessionPayload {
  role: AppRole;
  expiresAt: number;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function signature(payload: string, secret: string): Promise<string> {
  const bytes = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(bytes));
}

async function signatureIsValid(payload: string, supplied: string, secret: string): Promise<boolean> {
  try {
    return crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      base64UrlToBytes(supplied),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

export async function createSession(role: AppRole, secret: string): Promise<string> {
  const encoded = encodeBase64Url(JSON.stringify({
    role,
    expiresAt: Date.now() + sessionDurationMs,
  } satisfies SessionPayload));
  return `${encoded}.${await signature(encoded, secret)}`;
}

export async function readSession(value: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  if (!await signatureIsValid(payload, suppliedSignature, secret)) return null;

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as Partial<SessionPayload>;
    if ((parsed.role !== "patient" && parsed.role !== "product") ||
        typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

export function sessionMaxAgeSeconds(): number {
  return sessionDurationMs / 1000;
}
