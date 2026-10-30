import assert from "node:assert/strict";
import { HELP_ENTRIES, HELP_BY_ID } from "../src/lib/studio/help-content";
const views = [
  "home","cutter","joiner","pitcher","key-bpm","recorder","karaoke",
  "remover","splitter","models","queue","settings","system","help"
] as const;
assert.equal(HELP_ENTRIES.length, views.length, "Each page needs a help entry.");
assert.equal(new Set(HELP_ENTRIES.map((item) => item.id)).size, views.length, "Help IDs must be unique.");
for (const id of views) {
  const help = HELP_BY_ID[id];
  assert.ok(help && help.title && help.summary && help.availability, `Missing help for ${id}`);
  assert.ok(help.steps.length >= 3, `Missing procedure for ${id}`);
  assert.ok(help.controls.length >= 3, `Missing control tooltips for ${id}`);
  for (const control of help.controls) {
    assert.ok(control.label.trim() && control.description.length > 20, `Incomplete tooltip for ${id}`);
  }
}
assert.equal(HELP_BY_ID.splitter.availability, "Not implemented");
assert.equal(HELP_BY_ID.models.availability, "Metadata only");
assert.equal(HELP_BY_ID.remover.availability, "Requires a user-provided AI model");
assert.ok(HELP_BY_ID.home.caution?.includes("not a persistent project"));
console.log("PASS: help coverage, control descriptions and honest capability status for all views");
