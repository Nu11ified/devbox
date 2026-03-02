import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-muted-foreground">
        Manage agent credentials and default preferences.
      </p>
      <SettingsForm />
    </div>
  );
}
