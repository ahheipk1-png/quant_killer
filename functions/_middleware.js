// Temporary HTTP Basic Auth gate for the whole Cloudflare Pages site, while
// it's not ready for public visibility yet. A Pages Function "_middleware.js"
// at the project root runs on every request before it's served.
//
// Deliberately trivial credentials -- explicit user request, not meant to
// protect anything sensitive. The site's entire source is already public on
// GitHub (see /code.html); this is a "don't stumble on it by accident" gate,
// not real security. Swap USERNAME/PASSWORD or delete this file entirely
// before the site is meant to be shared widely.

const USERNAME = "admin";
const PASSWORD = "admin";

function unauthorized() {
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="QuantKiller", charset="UTF-8"' },
  });
}

export async function onRequest(context) {
  const auth = context.request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded;
  try {
    decoded = atob(auth.slice("Basic ".length));
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(":");
  const user = separator === -1 ? decoded : decoded.slice(0, separator);
  const pass = separator === -1 ? "" : decoded.slice(separator + 1);

  if (user !== USERNAME || pass !== PASSWORD) {
    return unauthorized();
  }

  return context.next();
}
