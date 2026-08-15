import assert from "node:assert/strict";
import { hasExactUrl } from "./url-contract.mjs";

const canonicalUrl = "https://oss.lupinum.com";

assert.equal(hasExactUrl(`[Handbook](${canonicalUrl})`, canonicalUrl), true);
assert.equal(hasExactUrl(`https://attacker.example/${canonicalUrl}`, canonicalUrl), false);
assert.equal(hasExactUrl(`${canonicalUrl}.attacker.example`, canonicalUrl), false);
assert.equal(hasExactUrl("No handbook URL is present.", canonicalUrl), false);

console.log("Exact URL contract passed.");
