export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  ADMIN_SESSION_SECRET: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil(promise: Promise<unknown>): void;
  next(): Promise<Response>;
}

export type PagesHandler = (context: PagesContext) => Response | Promise<Response>;

const SESSION_COOKIE = "chase_admin_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;

export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export async function readJson<T>(request: Request, maximumBytes = 20_000): Promise<T> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maximumBytes) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (text.length > maximumBytes) throw new Error("REQUEST_TOO_LARGE");
  return JSON.parse(text || "{}") as T;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function hmac(message: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function secureEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < Math.max(leftHash.length, rightHash.length); index += 1) {
    difference |= (leftHash[index] ?? 0) ^ (rightHash[index] ?? 0);
  }
  return difference === 0;
}

export async function createSessionCookie(secret: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const message = `admin:${expiresAt}`;
  const signature = await hmac(message, secret);
  return `${SESSION_COOKIE}=${expiresAt}.${signature}; Path=/; Max-Age=${SESSION_DURATION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

export async function isAdmin(request: Request, secret: string) {
  if (!secret) return false;
  const token = cookieValue(request, SESSION_COOKIE);
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expiresAt = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(`admin:${expiresAt}`, secret);
  return secureEqual(signature, expected);
}

export async function requireAdmin(context: PagesContext) {
  if (!(await isAdmin(context.request, context.env.ADMIN_SESSION_SECRET))) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  return null;
}

export function text(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}
