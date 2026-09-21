import { randomBytes, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
const sessionCookie = "__Host-observe-session";
const flowCookie = "__Host-observe-flow";
export function safeReturn(value) {
  if (typeof value === "string" && /^\/auth\/pricedip\?state=[A-Za-z0-9_-]{43}$/.test(value)) return value;
  return typeof value === "string" && /^\/owner\/(?:#[a-z-]+)?$/.test(value)
    ? value
    : "/owner/";
}
function cookie(req, name) {
  return (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export function createGoogleAuth(
  env,
  {
    keys = createRemoteJWKSet(
      new URL("https://www.googleapis.com/oauth2/v3/certs"),
    ),
    request = fetch,
  } = {},
) {
  const origin = "https://observe.ramideltoro.com";
  const redirect = origin + "/auth/google/callback";
  const secret = new TextEncoder().encode(env.SESSION_SECRET || "");
  const configured =
    secret.length >= 32 && !!env.AUTH_GOOGLE_ID && !!env.AUTH_GOOGLE_SECRET;
  const emails = (env.OWNER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const pending = new Map();
  const setCookie = (name, value, age) =>
    `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
  async function sign(payload) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(origin)
      .setAudience("observe-owner")
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(secret);
  }
  async function identity(req) {
    if (!configured) return false;
    try {
      const { payload } = await jwtVerify(cookie(req, sessionCookie), secret, {
        issuer: origin,
        audience: "observe-owner",
        algorithms: ["HS256"],
        maxTokenAge: "12h",
      });
      return (
        typeof payload.email === "string" &&
        emails.includes(payload.email.toLowerCase()) ? createHash("sha256").update(payload.email.toLowerCase()).digest("hex") : false
      );
    } catch {
      return false;
    }
  }
  async function owner(req) { return !!(await identity(req)); }
  const redirectTo = (res, location, cookies) => {
    res.writeHead(302, {
      Location: location,
      "Cache-Control": "private, no-store",
      ...(cookies ? { "Set-Cookie": cookies } : {}),
    });
    res.end();
  };
  async function handle(req, res, url) {
    if (!url.pathname.startsWith("/auth/")) return false;
    res.setHeader("Cache-Control", "private, no-store");
    if (url.pathname === "/auth/logout" && req.method === "POST") {
      if (req.headers.origin !== origin) {
        res.writeHead(403);
        res.end("Invalid origin");
        return true;
      }
      redirectTo(res, "/", setCookie(sessionCookie, "", 0));
      return true;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return true;
    }
    if (!configured) {
      res.writeHead(503);
      res.end("Google sign-in is not configured.");
      return true;
    }
    if (url.pathname === "/auth/pricedip") {
      const state = url.searchParams.get("state") || "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !env.PRICEDIP_AUTH_BRIDGE_SECRET) { res.writeHead(400); res.end("Invalid PriceDip sign-in request"); return true; }
      try {
        const {payload} = await jwtVerify(cookie(req, sessionCookie), secret, {issuer:origin,audience:"observe-owner",algorithms:["HS256"],maxTokenAge:"12h"});
        if(payload.email !== "rami.deltoro@gmail.com") { res.writeHead(403); res.end("PriceDip owner account required"); return true; }
        const token=await new SignJWT({email:payload.email,state}).setProtectedHeader({alg:"HS256"}).setIssuer(origin).setAudience("pricedip").setIssuedAt().setJti(randomBytes(16).toString("hex")).setExpirationTime("60s").sign(new TextEncoder().encode(env.PRICEDIP_AUTH_BRIDGE_SECRET));
        redirectTo(res,"https://pricedip.ramideltoro.com/auth/callback?token="+encodeURIComponent(token));
      } catch { redirectTo(res,"/auth/google?returnTo="+encodeURIComponent("/auth/pricedip?state="+state)); }
      return true;
    }
    if (url.pathname === "/auth/google") {
      for (const [id, flow] of pending)
        if (flow.expires < Date.now()) pending.delete(id);
      if (pending.size >= 1000) {
        res.writeHead(429);
        res.end("Please try again shortly.");
        return true;
      }
      const state = randomBytes(32).toString("base64url"),
        browser = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url"),
        nonce = randomBytes(32).toString("base64url");
      pending.set(state, {
        browser,
        verifier,
        nonce,
        returnTo: safeReturn(url.searchParams.get("returnTo")),
        expires: Date.now() + 600000,
      });
      const params = new URLSearchParams({
        client_id: env.AUTH_GOOGLE_ID,
        redirect_uri: redirect,
        response_type: "code",
        scope: "openid email",
        state,
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      redirectTo(
        res,
        "https://accounts.google.com/o/oauth2/v2/auth?" + params,
        setCookie(flowCookie, browser, 600),
      );
      return true;
    }
    if (url.pathname === "/auth/google/callback") {
      const state = url.searchParams.get("state"),
        flow = pending.get(state);
      pending.delete(state);
      res.setHeader("Set-Cookie", setCookie(flowCookie, "", 0));
      try {
        if (
          !flow ||
          flow.expires < Date.now() ||
          cookie(req, flowCookie) !== flow.browser ||
          !url.searchParams.get("code") ||
          url.searchParams.has("error")
        )
          throw Error("Invalid flow");
        const response = await request("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.AUTH_GOOGLE_ID,
            client_secret: env.AUTH_GOOGLE_SECRET,
            code: url.searchParams.get("code"),
            code_verifier: flow.verifier,
            grant_type: "authorization_code",
            redirect_uri: redirect,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) throw Error("Token exchange failed");
        const { id_token } = await response.json();
        const { payload } = await jwtVerify(id_token, keys, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: env.AUTH_GOOGLE_ID,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat", "sub", "nonce", "email"],
        });
        if (
          payload.nonce !== flow.nonce ||
          payload.email_verified !== true ||
          typeof payload.email !== "string" ||
          !emails.includes(payload.email.toLowerCase()) ||
          (payload.azp && payload.azp !== env.AUTH_GOOGLE_ID)
        )
          throw Error("Not authorized");
        redirectTo(res, flow.returnTo, [
          setCookie(flowCookie, "", 0),
          setCookie(
            sessionCookie,
            await sign({ sub: payload.sub, email: payload.email }),
            43200,
          ),
        ]);
      } catch {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          '<h1>Sign-in could not be completed</h1><p>Use an authorized owner Google account. Your sign-in may have expired.</p><a href="/auth/google">Try Google sign-in again</a> · <a href="/">Public overview</a>',
        );
      }
      return true;
    }
    res.writeHead(404);
    res.end();
    return true;
  }
  return { owner, identity, handle };
}
