import { Router, type Router as RouterType } from "express";
import prisma from "../db/prisma.js";

export const settingsRouter: RouterType = Router();

// GET /api/settings — current user's settings (auto-create if missing)
settingsRouter.get("/", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  // Mask API key — only return last 4 chars
  const masked = {
    ...settings,
    anthropicApiKey: settings.anthropicApiKey
      ? `****${settings.anthropicApiKey.slice(-4)}`
      : null,
  };

  res.json(masked);
});

// PUT /api/settings — update settings
settingsRouter.put("/", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const {
    selectedRepos,
    claudeSubscription,
    openaiSubscription,
    onboardingCompleted,
    defaultBlueprintId,
    agentPreference,
    defaultProvider,
    defaultModel,
    defaultRuntimeMode,
    defaultEffort,
    defaultTeamSize,
    anthropicApiKey,
  } = req.body;

  const data: Record<string, unknown> = {};
  if (selectedRepos !== undefined) data.selectedRepos = selectedRepos;
  if (claudeSubscription !== undefined) data.claudeSubscription = claudeSubscription;
  if (openaiSubscription !== undefined) data.openaiSubscription = openaiSubscription;
  if (onboardingCompleted !== undefined) data.onboardingCompleted = onboardingCompleted;
  if (defaultBlueprintId !== undefined) data.defaultBlueprintId = defaultBlueprintId;
  if (agentPreference !== undefined) data.agentPreference = agentPreference;
  if (defaultProvider !== undefined) data.defaultProvider = defaultProvider;
  if (defaultModel !== undefined) data.defaultModel = defaultModel;
  if (defaultRuntimeMode !== undefined) data.defaultRuntimeMode = defaultRuntimeMode;
  if (defaultEffort !== undefined) data.defaultEffort = defaultEffort;
  if (defaultTeamSize !== undefined) data.defaultTeamSize = defaultTeamSize;
  if (anthropicApiKey !== undefined) data.anthropicApiKey = anthropicApiKey;

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  res.json(settings);
});

// GET /api/settings/onboarding — check if onboarding is complete
settingsRouter.get("/onboarding", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });

  res.json({ completed: settings?.onboardingCompleted ?? false });
});
