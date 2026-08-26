import { NextRequest, NextResponse } from "next/server";

import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

function jsonUnauthorized(message: string, status = 401) {
  return NextResponse.json({ error: message }, { status });
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/login" || path.startsWith("/api/auth/")) return NextResponse.next();

  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return path.startsWith("/api/")
      ? jsonUnauthorized("Application authentication is not configured.", 503)
      : NextResponse.redirect(new URL("/login", request.url));
  }

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value, secret);
  if (!session) {
    return path.startsWith("/api/")
      ? jsonUnauthorized("Sign in is required.")
      : NextResponse.redirect(new URL("/login", request.url));
  }

  const productRoute = path.startsWith("/product-insights") || path.startsWith("/api/product-insights");
  if ((productRoute && session.role !== "product") || (!productRoute && session.role !== "patient")) {
    return path.startsWith("/api/")
      ? jsonUnauthorized("This account cannot access that workspace.", 403)
      : NextResponse.redirect(new URL(session.role === "product" ? "/product-insights" : "/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
