import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  createSession,
  type AppRole,
  SESSION_COOKIE,
  sessionMaxAgeSeconds,
} from "@/lib/auth/session";

export const runtime = "nodejs";

const attempts = new Map<string, { count: number; resetsAt: number }>();
const attemptWindowMs = 15 * 60 * 1000;
const maxAttempts = 5;

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

function recordFailedAttempt(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  const next = !current || current.resetsAt <= now
    ? { count: 1, resetsAt: now + attemptWindowMs }
    : { ...current, count: current.count + 1 };
  attempts.set(key, next);
  return next.count >= maxAttempts;
}

function matchesPassword(actual: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function POST(request: Request) {
  const key = clientKey(request);
  const current = attempts.get(key);
  if (current && current.resetsAt > Date.now() && current.count >= maxAttempts) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((current.resetsAt - Date.now()) / 1000)) } },
    );
  }
  const form = await request.formData();
  const role = form.get("role") === "product" ? "product" : "patient";
  const password = String(form.get("password") ?? "");
  const expected = role === "product"
    ? process.env.PRODUCT_ACCESS_PASSWORD
    : process.env.PATIENT_ACCESS_PASSWORD;
  const secret = process.env.APP_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Application authentication is not configured." }, { status: 503 });
  }
  if (!matchesPassword(password, expected)) {
    recordFailedAttempt(key);
    return NextResponse.redirect(new URL(`/login?error=invalid&role=${role}`, request.url), 303);
  }

  attempts.delete(key);

  const response = NextResponse.redirect(
    new URL(role === "product" ? "/product-insights" : "/", request.url),
    303,
  );
  response.cookies.set(SESSION_COOKIE, await createSession(role as AppRole, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: sessionMaxAgeSeconds(),
  });
  return response;
}
