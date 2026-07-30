import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
  const isLoginRoute =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/auth/login";
  const isOperationsApi =
    request.nextUrl.pathname === "/api/v1" ||
    request.nextUrl.pathname.startsWith("/api/v1/");

  // API v1 authenticates bearer tokens inside each route rather than with
  // browser cookies, so it must bypass the human-login redirect.
  if (isOperationsApi) {
    return supabaseResponse;
  }

  if (!isAuthenticated && !isLoginRoute) {
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
