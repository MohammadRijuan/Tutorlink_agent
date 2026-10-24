import "../../../test/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeMetaErrorMessage } from "../meta.service.js";

test("Meta error logging removes access tokens and credential-bearing URLs", () => {
  const token = "EA-secret-token";
  const message = `Rejected ${token}; see https://graph.facebook.com/me?access_token=${token}`;
  const sanitized = sanitizeMetaErrorMessage(message, token);

  assert.equal(sanitized.includes(token), false);
  assert.equal(sanitized.includes("https://"), false);
  assert.match(sanitized, /\[URL REDACTED\]/);
});
