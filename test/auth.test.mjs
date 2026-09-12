import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { verifyOwnerToken } from "../server/auth.mjs";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
jwk.kid = "fixture";
const keys = createLocalJWKSet({ keys: [jwk] });
const config = {
  issuer: "https://access.example.com",
  audience: ["portal-owner", "portal-api"],
  emails: ["owner@example.com"],
};
async function token({
  email = "owner@example.com",
  issuer = config.issuer,
  audience = "portal-owner",
  expiry = "1h",
} = {}) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(privateKey);
}
test("valid owner assertion is accepted", async () =>
  assert.equal(await verifyOwnerToken(await token(), keys, config), true));
test("missing or forged assertions are rejected", async () => {
  assert.equal(await verifyOwnerToken(undefined, keys, config), false);
  assert.equal(
    await verifyOwnerToken("spoofed-email:owner@example.com", keys, config),
    false,
  );
});
test("wrong audience, issuer, identity, and expired claims are rejected", async () => {
  for (const options of [
    { audience: "other-app" },
    { issuer: "https://attacker.example.com" },
    { email: "other@example.com" },
    { expiry: "-1h" },
  ])
    assert.equal(
      await verifyOwnerToken(await token(options), keys, config),
      false,
    );
});
