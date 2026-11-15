import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = join(__dirname, "..");
const read = (file: string): string => readFileSync(join(root, file), "utf8");

describe("action.yml", () => {
  const doc = parseDocument(read("action.yml"));
  const manifest = doc.toJS() as {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    runs: { using: string; main: string };
  };
  const source = read("src/main.ts");

  it("is valid YAML", () => {
    expect(doc.errors).toEqual([]);
  });

  it("declares exactly the inputs that main.ts reads", () => {
    const used = [...source.matchAll(/get(?:Boolean)?Input\("([^"]+)"/g)].map((match) => match[1]);
    expect(Object.keys(manifest.inputs).sort()).toEqual([...new Set(used)].sort());
  });

  it("declares exactly the outputs that main.ts sets", () => {
    const set = [...source.matchAll(/setOutput\("([^"]+)"/g)].map((match) => match[1]);
    expect(Object.keys(manifest.outputs).sort()).toEqual(set.sort());
  });

  it("points at the committed bundle", () => {
    expect(manifest.runs).toEqual({ using: "node24", main: "dist/index.js" });
    expect(read(manifest.runs.main).length).toBeGreaterThan(0);
  });
});
