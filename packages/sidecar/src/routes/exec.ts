import { Router } from "express";
import { execFile } from "node:child_process";

const router = Router();

router.post("/exec", (req, res) => {
  const { cmd, args = [], cwd, timeout = 30000 } = req.body;

  if (!cmd || typeof cmd !== "string") {
    res.status(400).json({ error: "cmd is required and must be a string" });
    return;
  }

  const opts: { cwd?: string; timeout: number } = { timeout };
  if (cwd) opts.cwd = cwd;

  execFile(cmd, args, opts, (error, stdout, stderr) => {
    if (error && error.killed) {
      res.json({
        exitCode: 1,
        stdout: stdout ?? "",
        stderr: "Process timed out and was killed",
      });
      return;
    }

    if (error && !("code" in error && typeof error.code === "number")) {
      // ENOENT or similar system errors
      res.json({
        exitCode: 1,
        stdout: "",
        stderr: error.message,
      });
      return;
    }

    res.json({
      exitCode: error ? (error.code ?? 1) : 0,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
    });
  });
});

export default router;
