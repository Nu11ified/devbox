import prisma from "./prisma.js";

/**
 * Creates a default "Flexible" template if no templates exist.
 * Uses ubuntu:22.04 with egress allowed so agents can install
 * whatever dev dependencies they need (apt, npm, pip, etc.).
 */
export async function seedDefaultTemplate(): Promise<void> {
  const count = await prisma.devboxTemplate.count();
  if (count > 0) return;

  await prisma.devboxTemplate.create({
    data: {
      name: "flexible",
      baseImage: "ubuntu:22.04",
      resourceLimits: { cpus: 2, memoryMB: 4096, diskMB: 20480 },
      toolBundles: [],
      envVars: {
        DEBIAN_FRONTEND: "noninteractive",
        LANG: "C.UTF-8",
      },
      bootstrap: [
        "apt-get update -qq",
        "apt-get install -y -qq git curl wget build-essential ca-certificates",
      ],
      networkPolicy: "egress-allowed",
      repos: [],
    },
  });

  console.log("[seed] Created default 'flexible' template");
}
