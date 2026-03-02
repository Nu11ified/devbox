import { RunForm } from "@/components/run-form";

export default function NewRunPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">New Run</h1>
      <p className="text-muted-foreground">
        Configure and launch an autonomous coding run.
      </p>
      <RunForm />
    </div>
  );
}
