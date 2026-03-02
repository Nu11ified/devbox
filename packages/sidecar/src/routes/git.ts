import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const router = Router();

function gitExec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd });
}

// GET /git/status — parse `git status --porcelain=v2`
router.get("/git/status", async (req, res) => {
  const cwd = (req.query.cwd as string) || "/workspace";
  try {
    const { stdout } = await gitExec(
      ["status", "--porcelain=v2", "--untracked-files"],
      cwd
    );
    const files = stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        if (line.startsWith("?")) {
          // Untracked: ? path
          return { path: line.slice(2), status: "?" };
        }
        if (line.startsWith("1") || line.startsWith("2")) {
          // Changed entries: 1 XY ... path  or  2 XY ... path\torig_path
          const parts = line.split(" ");
          const xy = parts[1];
          const path = parts.slice(8).join(" ").split("\t")[0];
          return { path, status: xy };
        }
        return null;
      })
      .filter(Boolean);

    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /git/diff — unified diff
router.get("/git/diff", async (req, res) => {
  const cwd = (req.query.cwd as string) || "/workspace";
  try {
    const { stdout } = await gitExec(["diff"], cwd);
    res.json({ diff: stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /git/apply — apply patch with --3way
router.post("/git/apply", async (req, res) => {
  const { cwd = "/workspace", patch } = req.body;
  if (!patch) {
    res.status(400).json({ error: "patch is required" });
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        "git",
        ["apply", "--3way", "-"],
        { cwd },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
      child.stdin!.write(patch);
      child.stdin!.end();
    });
    res.json({ success: true });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// POST /git/commit — add all + commit, return SHA
router.post("/git/commit", async (req, res) => {
  const { cwd = "/workspace", message = "Auto-commit" } = req.body;
  try {
    await gitExec(["add", "-A"], cwd);
    await gitExec(["commit", "-m", message], cwd);
    const { stdout } = await gitExec(["rev-parse", "HEAD"], cwd);
    res.json({ sha: stdout.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /git/push — push to remote
router.post("/git/push", async (req, res) => {
  const { cwd = "/workspace", remote = "origin", branch } = req.body;
  try {
    const args = ["push", remote];
    if (branch) args.push(branch);
    await gitExec(args, cwd);
    res.json({ success: true });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

export default router;
