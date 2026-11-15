import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as art from "../src/burrow/generated/art.js";
import { stashArt, wreathArt } from "../src/burrow/generated/scenes.ts";

const root = new URL("..", import.meta.url).pathname;
const generated = join(root, "src/burrow/generated");

test("src/burrow/generated is what burrow/generate.cjs makes from the export", () => {
  const out = mkdtempSync(join(tmpdir(), "burrow-"));
  try {
    execFileSync(process.execPath, [join(root, "burrow/generate.cjs")], { env: { ...process.env, BURROW_OUT: out }, stdio: "pipe" });
    const files = readdirSync(out).sort();
    expect(readdirSync(generated).sort()).toEqual(files);
    for (const f of files) expect(readFileSync(join(generated, f), "utf8"), f).toBe(readFileSync(join(out, f), "utf8"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the art draws without React, for every animal, mood, trace and habitat", () => {
  for (const who of ["bao", "kacang", "gali", "kayu"] as const) {
    for (const mood of art.MOODS) expect(art.mascotSVG(who, mood)).toMatch(/^<svg[\s\S]*<\/svg>$/);
  }
  for (const name of Object.keys(art.TRACES) as art.TraceName[]) expect(art.traceSVG(name, 32)).toContain('width="32"');
  for (const hab of Object.values(art.HAB)) expect(hab.props()).toContain("<");
  expect(art.worldSVG()).toMatch(/^<svg/);
  expect(art.trailSVG({ kind: "acorns", points: [[0, 0], [100, 200]], width: 100, height: 200 })).toContain("<svg");
});

test("a stash shows one acorn per slot filled, and the wreath one lit leaf per share", () => {
  const acorns = (n: number) => stashArt(n).split(`fill="${art.C.acorn}"`).length - 1;
  for (const n of [0, 1, 7, 15]) expect(acorns(n)).toBe(n);
  expect(wreathArt(0)).not.toContain("is-on");
  expect(wreathArt(10).split("bh-wleaf is-on").length - 1).toBe(10);
  expect(wreathArt(26).split("bh-wleaf is-on").length - 1).toBe(26);
});
