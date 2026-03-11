import { Settings } from "lucide-react";
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-6 w-6 text-zinc-400" />
          Settings
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Manage your GitHub connection, agent credentials, and default preferences.
        </p>
      </div>
      <SettingsForm />
    </div>
  );
}
