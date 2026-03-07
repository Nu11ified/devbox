import { describe, expect, test } from "vitest";
import { parseDiff } from "../src/providers/claude-code/parse-diff.js";

describe("parseDiff", () => {
  test("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("   \n\n  ")).toEqual([]);
  });

  test("parses a modified file", () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import express from "express";
+import cors from "cors";

 const app = express();
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/index.ts");
    expect(files[0].status).toBe("modified");
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0].header).toBe("@@ -1,3 +1,4 @@");

    const lines = files[0].hunks[0].lines;
    expect(lines[0]).toEqual({ type: "context", content: 'import express from "express";' });
    expect(lines[1]).toEqual({ type: "add", content: 'import cors from "cors";' });
    expect(lines[2]).toEqual({ type: "context", content: "" });
    expect(lines[3]).toEqual({ type: "context", content: "const app = express();" });
  });

  test("parses a new file (added)", () => {
    const diff = `diff --git a/newfile.txt b/newfile.txt
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("newfile.txt");
    expect(files[0].status).toBe("added");
    expect(files[0].hunks[0].lines).toEqual([
      { type: "add", content: "hello" },
      { type: "add", content: "world" },
    ]);
  });

  test("parses a deleted file", () => {
    const diff = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index abc1234..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-goodbye
-world
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("old.txt");
    expect(files[0].status).toBe("deleted");
    expect(files[0].hunks[0].lines).toEqual([
      { type: "remove", content: "goodbye" },
      { type: "remove", content: "world" },
    ]);
  });

  test("parses multiple files", () => {
    const diff = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
new file mode 100644
index 000..333
--- /dev/null
+++ b/b.ts
@@ -0,0 +1 @@
+content
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("a.ts");
    expect(files[0].status).toBe("modified");
    expect(files[1].path).toBe("b.ts");
    expect(files[1].status).toBe("added");
  });

  test("skips binary files", () => {
    const diff = `diff --git a/image.png b/image.png
Binary files /dev/null and b/image.png differ
diff --git a/code.ts b/code.ts
index 111..222 100644
--- a/code.ts
+++ b/code.ts
@@ -1 +1 @@
-old
+new
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("code.ts");
  });

  test("handles multiple hunks in one file", () => {
    const diff = `diff --git a/big.ts b/big.ts
index 111..222 100644
--- a/big.ts
+++ b/big.ts
@@ -1,3 +1,3 @@
 line1
-line2
+LINE2
 line3
@@ -10,3 +10,3 @@
 line10
-line11
+LINE11
 line12
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);
    expect(files[0].hunks[0].header).toBe("@@ -1,3 +1,3 @@");
    expect(files[0].hunks[1].header).toBe("@@ -10,3 +10,3 @@");
  });
});
