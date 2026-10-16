// Prints canonical forms and subject hashes for vectors/canonical.json inputs.
// Run after `npm run build`: node scripts/hashes.mjs
import { readFileSync } from "node:fs";
import { canonicalize, subjectHash } from "../dist/index.js";

const cases = JSON.parse(readFileSync(new URL("../vectors/canonical.json", import.meta.url)));
for (const c of cases.cases)
  console.log(
    JSON.stringify({
      ...c,
      canonical: canonicalize(c.input),
      subject_hash: await subjectHash(c.input),
    }),
  );
