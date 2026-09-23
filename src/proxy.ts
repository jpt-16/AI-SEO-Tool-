import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

function sameSecret(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

// Pages anyone can read: Google's OAuth review needs the homepage and policies public.
const PUBLIC_PATHS = new Set(["/", "/privacy", "/terms", "/icon.png"]);

// HTTP Basic auth in front of the whole app: it shows client data and holds a Google token.
export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    return new NextResponse("Set ADMIN_USERNAME and ADMIN_PASSWORD to use this app.", { status: 503 });
  }

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const userOk = sameSecret(decoded.slice(0, separator), username);
    const passOk = sameSecret(decoded.slice(separator + 1), password);
    if (separator !== -1 && userOk && passOk) return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="JT Builds SEO", charset="UTF-8"' },
  });
}

export const config = {
  // The cron route authenticates with CRON_SECRET instead.
  matcher: ["/((?!api/cron/|_next/static|_next/image|favicon.ico).*)"],
};
