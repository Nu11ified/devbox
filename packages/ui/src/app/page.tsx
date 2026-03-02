import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="flex flex-col items-center gap-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Patchwork</h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Autonomous multi-agent coding platform. Orchestrate AI agents inside
          isolated containers to produce PR-ready branches.
        </p>
        <Link
          href="/runs"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          View Runs
        </Link>
      </main>
    </div>
  );
}
