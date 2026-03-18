"use client";

import { useState, useEffect } from "react";
import {
  Edit3,
  Trash2,
  Save,
  X,
  FileText,
  AlertTriangle,
  Eye,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnkiCard } from "@/lib/api";

interface CardDetailProps {
  card: AnkiCard;
  onUpdate: (data: Partial<{ group: string; title: string; contents: string; referencedFiles: string[] }>) => void;
  onDelete: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CardDetail({ card, onUpdate, onDelete }: CardDetailProps) {
  const [editing, setEditing] = useState(false);
  const [editContents, setEditContents] = useState(card.contents);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteTimer, setDeleteTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Reset edit state when card changes
  useEffect(() => {
    setEditing(false);
    setEditContents(card.contents);
    setDeleteConfirm(false);
    if (deleteTimer) clearTimeout(deleteTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  function handleSave() {
    onUpdate({ contents: editContents });
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditContents(card.contents);
    setEditing(false);
  }

  function handleDeleteClick() {
    if (deleteConfirm) {
      if (deleteTimer) clearTimeout(deleteTimer);
      onDelete();
    } else {
      setDeleteConfirm(true);
      const timer = setTimeout(() => {
        setDeleteConfirm(false);
        setDeleteTimer(null);
      }, 3000);
      setDeleteTimer(timer);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-800/40 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {card.group}
            </span>
          </div>
          <h2 className="text-base font-semibold text-zinc-100 leading-snug">
            {card.title}
          </h2>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Edit card"
            >
              <Edit3 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={handleDeleteClick}
            className={cn(
              "p-1.5 rounded transition-colors",
              deleteConfirm
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300"
            )}
            title={deleteConfirm ? "Click again to confirm delete" : "Delete card"}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stale warning */}
      {card.stale && (
        <div className="flex items-start gap-2.5 px-5 py-3 bg-amber-500/5 border-b border-amber-500/20 shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-500/70 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-500/80">Card may be outdated</p>
            {card.staleReason && (
              <p className="text-xs text-amber-500/60 mt-0.5">{card.staleReason}</p>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {editing ? (
          <textarea
            value={editContents}
            onChange={(e) => setEditContents(e.target.value)}
            className="w-full h-full min-h-[200px] bg-zinc-900/50 border border-zinc-800/40 rounded p-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-none font-mono transition-colors"
            placeholder="Card contents (markdown supported)..."
            autoFocus
          />
        ) : (
          <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
            {card.contents}
          </pre>
        )}
      </div>

      {/* Edit action bar */}
      {editing && (
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-800/40 shrink-0">
          <button
            onClick={handleCancelEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-zinc-100 text-zinc-900 hover:bg-zinc-200 rounded font-medium transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
        </div>
      )}

      {/* Metadata footer */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 border-t border-zinc-800/40 shrink-0">
        <span className="flex items-center gap-1.5 text-xs text-zinc-600">
          <FileText className="h-3.5 w-3.5" />
          {card.referencedFiles.length} referenced file{card.referencedFiles.length !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-600">
          <Eye className="h-3.5 w-3.5" />
          {card.accessCount} access{card.accessCount !== 1 ? "es" : ""}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-600">
          <Clock className="h-3.5 w-3.5" />
          Verified {formatDate(card.lastVerifiedAt)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-600">
          <Clock className="h-3.5 w-3.5" />
          Updated {formatDate(card.updatedAt)}
        </span>
      </div>
    </div>
  );
}
