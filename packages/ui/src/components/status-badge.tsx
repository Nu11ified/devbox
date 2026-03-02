import type { RunStatus } from "@patchwork/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<RunStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  },
  provisioning: {
    label: "Provisioning",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  },
  running: {
    label: "Running",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 animate-pulse",
  },
  waiting_ci: {
    label: "Waiting CI",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
  },
  completed: {
    label: "Completed",
    className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/30",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const config = statusConfig[status] ?? statusConfig.pending;
  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
