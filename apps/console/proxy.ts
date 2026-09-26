// Sends signed-out visitors on app pages to /login. The landing page and /login stay public.
// With auth off (see auth.ts) every page is open.
import { NextResponse, type NextRequest } from "next/server";
import { auth, authEnabled } from "@/auth";

const gate = auth((req) => {
  if (req.auth) return NextResponse.next();
  const login = new URL("/login", req.nextUrl.origin);
  login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
});

export function proxy(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  if (!authEnabled) return NextResponse.next();
  return gate(req, ctx);
}

export const config = {
  matcher: ["/chat/:path*", "/console/:path*", "/dashboard/:path*", "/connect/:path*"],
};
