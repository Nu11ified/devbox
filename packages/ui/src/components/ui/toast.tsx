"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { X, CheckCircle2, AlertCircle, Info, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info" | "progress" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  stages?: string[];
  currentStage?: number;
  onClick?: () => void;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, "id">) => string;
  updateToast: (id: string, updates: Partial<Toast>) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((opts: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...opts, id }]);

    if (opts.type !== "progress") {
      const duration = opts.duration ?? 4000;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const updateToast = useCallback((id: string, updates: Partial<Toast>) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast, updateToast, dismissToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={() => dismissToast(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const iconMap: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  progress: Loader2,
  warning: AlertTriangle,
};

const colorMap: Record<ToastType, string> = {
  success: "text-emerald-400",
  error: "text-red-400",
  info: "text-zinc-400",
  progress: "text-blue-400",
  warning: "text-amber-400",
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [show, setShow] = useState(false);
  const Icon = iconMap[toast.type];

  useEffect(() => {
    requestAnimationFrame(() => setShow(true));
  }, []);

  return (
    <div
      className={cn(
        "bg-zinc-900 border border-zinc-800/60 rounded-lg shadow-xl px-4 py-3 flex items-start gap-3 transition-all duration-200",
        show
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-2"
      )}
      onClick={() => {
        if (toast.onClick) {
          toast.onClick();
          onDismiss();
        }
      }}
      style={{ cursor: toast.onClick ? "pointer" : undefined }}
    >
      <Icon
        className={cn(
          "h-4 w-4 mt-0.5 shrink-0",
          colorMap[toast.type],
          toast.type === "progress" && "animate-spin"
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100">{toast.title}</p>
        {toast.description && (
          <p className="text-xs text-zinc-500 mt-0.5">{toast.description}</p>
        )}
        {toast.stages && toast.stages.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {toast.stages.map((stage, i) => (
              <div
                key={stage}
                className={cn(
                  "text-[11px] font-mono flex items-center gap-1.5",
                  i < (toast.currentStage ?? 0)
                    ? "text-emerald-400"
                    : i === (toast.currentStage ?? 0)
                      ? "text-blue-400"
                      : "text-zinc-600"
                )}
              >
                {i < (toast.currentStage ?? 0) ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : i === (toast.currentStage ?? 0) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <div className="h-3 w-3 rounded-full border border-zinc-700" />
                )}
                {stage}
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
