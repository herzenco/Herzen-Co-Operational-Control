import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const isPublicAuthRoute = [
    "/login", "/recover", "/reset-password", "/auth/callback",
    "/api/auth/login", "/api/auth/recover", "/api/auth/update-password",
  ].includes(request.nextUrl.pathname);
  const isOperationsApi =
    request.nextUrl.pathname === "/api/v1" ||
    request.nextUrl.pathname.startsWith("/api/v1/");
  const isPublicAutomationRoute =
    request.nextUrl.pathname === "/api/cron/content-automation" ||
    request.nextUrl.pathname === "/api/review/content" ||
    request.nextUrl.pathname.startsWith("/review/content/") ||
    request.nextUrl.pathname.startsWith("/api/integrations/");

  // Allow local smoke tests and unauthenticated shells to render predictable
  // boundaries even when project secrets are not loaded.
  if (!supabaseUrl || !supabaseKey) {
    if (!isPublicAuthRoute && !isOperationsApi && !isPublicAutomationRoute) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      return NextResponse.redirect(loginUrl);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          supabaseResponse = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );

          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Validates the JWT and refreshes expired credentials when necessary.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);
  // API v1 authenticates bearer tokens inside each route rather than with
  // browser cookies, so it must bypass the human-login redirect.
  if (isOperationsApi || isPublicAutomationRoute) {
    return supabaseResponse;
  }

  if (!isAuthenticated && !isPublicAuthRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && request.nextUrl.pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}
