import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { createGoogleAuth, safeReturn } from "../server/google-auth.mjs";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const env = {
  SESSION_SECRET: "x".repeat(64),
  AUTH_GOOGLE_ID: "client",
  AUTH_GOOGLE_SECRET: "secret",
  OWNER_EMAILS: "owner@example.com",
};
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body;
    },
  };
}
async function flow(overrides = {}) {
  let nonce, exchanged;
  const auth = createGoogleAuth(env, {
    keys: publicKey,
    request: async (_url, options) => {
      exchanged = options.body;
      return {
        ok: true,
        json: async () => ({
          id_token: await new SignJWT({
            email: "owner@example.com",
            email_verified: true,
            nonce,
            ...overrides,
          })
            .setProtectedHeader({ alg: "RS256" })
            .setSubject("owner")
            .setIssuer("https://accounts.google.com")
            .setAudience("client")
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(privateKey),
        }),
      };
    },
  });
  const start = response();
  await auth.handle(
    { method: "GET", headers: {} },
    start,
    new URL(
      "https://observe.ramideltoro.com/auth/google?returnTo=%2Fowner%2F%23nutsnews",
    ),
  );
  const google = new URL(start.headers.Location);
  nonce = google.searchParams.get("nonce");
  const callback = new URL(
    "https://observe.ramideltoro.com/auth/google/callback?code=code&state=" +
      google.searchParams.get("state"),
  );
  const req = {
    method: "GET",
    headers: { cookie: start.headers["Set-Cookie"].split(";")[0] },
  };
  return { auth, start, google, callback, req, exchanged: () => exchanged };
}
test("Google flow uses PKCE and issues a bounded verified owner session", async () => {
  const f = await flow(),
    res = response();
  assert.equal(f.google.hostname, "accounts.google.com");
  assert.equal(f.google.searchParams.get("code_challenge_method"), "S256");
  await f.auth.handle(f.req, res, f.callback);
  assert.equal(res.status, 302);
  assert.equal(res.headers.Location, "/owner/#nutsnews");
  assert(f.exchanged().get("code_verifier"));
  const session = res.headers["Set-Cookie"][1];
  assert.match(session, /HttpOnly; Secure; SameSite=Lax; Max-Age=43200/);
  assert.equal(
    await f.auth.owner({ headers: { cookie: session.split(";")[0] } }),
    true,
  );
  assert.equal(
    await f.auth.owner({
      headers: { cookie: session.split(";")[0] + "forged" },
    }),
    false,
  );
  const replay = response();
  await f.auth.handle(f.req, replay, f.callback);
  assert.equal(replay.status, 403);
});
for (const [name, claim] of Object.entries({
  nonce: { nonce: "wrong" },
  email: { email: "other@example.com" },
  unverified: { email_verified: false },
  audience: { azp: "other" },
}))
  test("Reject " + name, async () => {
    const f = await flow(claim),
      res = response();
    await f.auth.handle(f.req, res, f.callback);
    assert.equal(res.status, 403);
  });
test("Reject callback without browser binding and all header bypasses", async () => {
  const f = await flow(),
    res = response();
  await f.auth.handle({ method: "GET", headers: {} }, res, f.callback);
  assert.equal(res.status, 403);
  assert.equal(
    await f.auth.owner({ headers: { "cf-access-jwt-assertion": "forged" } }),
    false,
  );
});
test("Return destinations cannot redirect externally", () => {
  for (const s of [
    "//evil.com",
    "https://evil.com",
    "/owner/../api/",
    "/owner/#<script>",
  ])
    assert.equal(safeReturn(s), "/owner/");
  assert.equal(safeReturn("/owner/#nutsnews"), "/owner/#nutsnews");
});
test("Expired and cross-application sessions are rejected", async () => {
  const auth = createGoogleAuth(env, { keys: publicKey });
  for (const [expiration, audience] of [
    ["1 second ago", "observe-owner"],
    ["1h", "other-app"],
  ]) {
    const token = await new SignJWT({ email: "owner@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://observe.ramideltoro.com")
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .sign(new TextEncoder().encode(env.SESSION_SECRET));
    assert.equal(
      await auth.owner({
        headers: { cookie: "__Host-observe-session=" + token },
      }),
      false,
    );
  }
});
test("Logout clears the cookie only for a same-origin POST", async () => {
  const auth = createGoogleAuth(env, { keys: publicKey });
  const denied = response();
  await auth.handle(
    { method: "POST", headers: { origin: "https://evil.example" } },
    denied,
    new URL("https://observe.ramideltoro.com/auth/logout"),
  );
  assert.equal(denied.status, 403);
  const res = response();
  await auth.handle(
    { method: "POST", headers: { origin: "https://observe.ramideltoro.com" } },
    res,
    new URL("https://observe.ramideltoro.com/auth/logout"),
  );
  assert.equal(res.status, 302);
  assert.match(res.headers["Set-Cookie"], /Max-Age=0/);
});
