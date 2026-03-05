import { BUILTIN_BLUEPRINTS } from "../blueprints/definitions.js";
import { BlueprintEngine } from "../blueprints/engine.js";
import { PersistentBlueprintRunner } from "../blueprints/persistent-runner.js";
import { DevboxManager } from "../devbox/manager.js";
import { SidecarHttpClient } from "../agents/sidecar-client.js";
import { AgentRouter } from "../agents/router.js";
import { PatchStore } from "../patchwork/store.js";
import { getPool, findTemplateById, updateIssue } from "../db/queries.js";
import prisma from "../db/prisma.js";
import type { AgentBackend } from "@patchwork/shared";

const devboxManager = new DevboxManager();
const engine = new BlueprintEngine();
const patchStore = new PatchStore();

/**
 * Dispatches a single issue: provisions a devbox, executes the blueprint,
 * and updates statuses throughout. Wrapped in try/finally for cleanup.
 */
export async function dispatchIssue(issue: {
  id: string;
  identifier: string;
  blueprintId: string;
  templateId: string | null;
  repo: string;
  branch: string;
  title: string;
  body: string;
  createdByUserId?: string | null;
}): Promise<void> {
  const db = getPool();

  // Resolve user subscription settings
  const userSettings = issue.createdByUserId
    ? await prisma.userSettings.findUnique({
        where: { userId: issue.createdByUserId },
      })
    : null;

  // 1. Validate blueprint
  const definition = BUILTIN_BLUEPRINTS.get(issue.blueprintId);
  if (!definition) {
    await updateIssue(issue.id, {
      status: "open",
      lastError: `Unknown blueprint: ${issue.blueprintId}`,
    });
    return;
  }

  // 2. Resolve template
  let template;
  if (issue.templateId) {
    template = await findTemplateById(issue.templateId);
  }
  if (!template) {
    template = await prisma.devboxTemplate.findFirst({
      orderBy: { createdAt: "asc" },
    });
  }
  if (!template) {
    await updateIssue(issue.id, {
      status: "open",
      lastError: "No devbox template available",
    });
    return;
  }

  // 3. Create run row
  const runResult = await db.query(
    `INSERT INTO runs (blueprint_id, repo, branch, task_description, status, config)
     VALUES ($1, $2, $3, $4, 'pending', '{}')
     RETURNING *`,
    [issue.blueprintId, issue.repo, issue.branch, `${issue.title}\n\n${issue.body}`]
  );
  const runId: string = runResult.rows[0].id;

  // 4. Link issue to run
  await updateIssue(issue.id, { runId, status: "in_progress" });

  let containerId: string | null = null;

  try {
    // 5. Provision devbox
    await db.query(
      "UPDATE runs SET status = 'provisioning', updated_at = now() WHERE id = $1",
      [runId]
    );

    const resourceLimits = (template.resourceLimits ?? {}) as Record<string, any>;
    const envVars = (template.envVars ?? {}) as Record<string, string>;
    const baseImage = template.baseImage;
    const networkPolicy = template.networkPolicy;
    const devboxInfo = await devboxManager.create({
      image: baseImage,
      name: `patchwork-${issue.identifier.toLowerCase()}`,
      env: typeof envVars === "object" ? envVars : {},
      cpus: resourceLimits.cpus,
      memoryMB: resourceLimits.memoryMB,
      networkMode: networkPolicy === "egress-allowed" ? "bridge" : "none",
    });
    containerId = devboxInfo.containerId;

    // 6. Record devbox in DB
    await db.query(
      `INSERT INTO devboxes (template_id, status, container_id, host, run_id, last_seen_at)
       VALUES ($1, 'running', $2, $3, $4, now())`,
      [template.id, devboxInfo.containerId, devboxInfo.host, runId]
    );

    // 7. Update run with devbox info
    const devboxRow = await db.query(
      "SELECT id FROM devboxes WHERE container_id = $1",
      [devboxInfo.containerId]
    );
    await db.query(
      "UPDATE runs SET devbox_id = $1, status = 'running', updated_at = now() WHERE id = $2",
      [devboxRow.rows[0].id, runId]
    );

    // 8. Connect sidecar
    const sidecar = new SidecarHttpClient(`http://${devboxInfo.host}:9999`);

    // 9. Create persistent runner
    const runner = new PersistentBlueprintRunner();

    // 10. Build backend factory
    const registeredBackends = new Map<string, AgentBackend>();
    const agentRouter = new AgentRouter(registeredBackends);
    const backendFactory = (role: string) =>
      agentRouter.selectBackend(
        {
          description: issue.title,
          repo: issue.repo,
          branch: issue.branch,
          templateId: template.id,
          blueprintId: issue.blueprintId,
        },
        role
      );

    // 11. Execute blueprint
    const result = await engine.execute(
      definition,
      runner,
      runId,
      {
        description: `${issue.title}\n\n${issue.body}`,
        repo: issue.repo,
        branch: issue.branch,
        templateId: template.id,
        blueprintId: issue.blueprintId,
        config: {
          useSubscription: userSettings?.claudeSubscription ?? false,
        },
      },
      backendFactory,
      sidecar,
      patchStore
    );

    // 12. Update final statuses
    if (result.status === "completed") {
      await updateIssue(issue.id, { status: "review", lastError: null });
    } else {
      await updateIssue(issue.id, {
        lastError: `Run finished with status: ${result.status}`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      "UPDATE runs SET status = 'failed', updated_at = now() WHERE id = $1",
      [runId]
    );
    await updateIssue(issue.id, { lastError: message });
  } finally {
    // 13. Teardown devbox
    if (containerId) {
      try {
        await devboxManager.destroy(containerId);
        await db.query(
          "UPDATE devboxes SET status = 'destroyed' WHERE container_id = $1",
          [containerId]
        );
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
