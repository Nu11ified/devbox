"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface NewCardModalProps {
  existingGroups: string[];
  onSave: (data: {
    group: string;
    title: string;
    contents: string;
    referencedFiles: string[];
  }) => void;
  onClose: () => void;
}

function normalizeGroup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const NEW_GROUP_OPTION = "__new__";

export function NewCardModal({ existingGroups, onSave, onClose }: NewCardModalProps) {
  const [selectedGroup, setSelectedGroup] = useState<string>(
    existingGroups.length > 0 ? existingGroups[0] : NEW_GROUP_OPTION
  );
  const [newGroupInput, setNewGroupInput] = useState("");
  const [title, setTitle] = useState("");
  const [contents, setContents] = useState("");
  const [referencedFilesRaw, setReferencedFilesRaw] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isNewGroup = selectedGroup === NEW_GROUP_OPTION;
  const groupValue = isNewGroup ? normalizeGroup(newGroupInput) : selectedGroup;

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!groupValue || !/^[a-z0-9-]+$/.test(groupValue)) {
      errs.group = "Group must contain only lowercase letters, numbers, and hyphens";
    }
    if (!title.trim()) {
      errs.title = "Title is required";
    }
    if (!contents.trim()) {
      errs.contents = "Contents are required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const referencedFiles = referencedFilesRaw
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    onSave({
      group: groupValue,
      title: title.trim(),
      contents: contents.trim(),
      referencedFiles,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg mx-4 bg-zinc-900 border border-zinc-800/60 rounded-xl shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
          <h3 className="text-base font-semibold text-zinc-100">New Knowledge Card</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Group selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Group
            </label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800/40 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600 transition-colors"
            >
              {existingGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={NEW_GROUP_OPTION}>New group...</option>
            </select>
            {isNewGroup && (
              <div className="mt-2">
                <input
                  type="text"
                  value={newGroupInput}
                  onChange={(e) => setNewGroupInput(e.target.value)}
                  placeholder="e.g. architecture, setup, debugging"
                  className={cn(
                    "w-full bg-zinc-900/50 border rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none transition-colors",
                    errors.group ? "border-red-500/50 focus:border-red-500" : "border-zinc-800/40 focus:border-zinc-600"
                  )}
                  autoFocus
                />
                {groupValue && (
                  <p className="text-xs text-zinc-600 mt-1">
                    Normalized: <span className="text-zinc-400 font-mono">{groupValue}</span>
                  </p>
                )}
              </div>
            )}
            {errors.group && (
              <p className="text-xs text-red-400 mt-1">{errors.group}</p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short descriptive title"
              className={cn(
                "w-full bg-zinc-900/50 border rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none transition-colors",
                errors.title ? "border-red-500/50 focus:border-red-500" : "border-zinc-800/40 focus:border-zinc-600"
              )}
            />
            {errors.title && (
              <p className="text-xs text-red-400 mt-1">{errors.title}</p>
            )}
          </div>

          {/* Contents */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Contents
            </label>
            <textarea
              value={contents}
              onChange={(e) => setContents(e.target.value)}
              placeholder="Card contents (markdown supported)..."
              rows={6}
              className={cn(
                "w-full bg-zinc-900/50 border rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none resize-none font-mono transition-colors",
                errors.contents ? "border-red-500/50 focus:border-red-500" : "border-zinc-800/40 focus:border-zinc-600"
              )}
            />
            {errors.contents && (
              <p className="text-xs text-red-400 mt-1">{errors.contents}</p>
            )}
          </div>

          {/* Referenced files */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Referenced Files{" "}
              <span className="text-zinc-600 font-normal">(one path per line, optional)</span>
            </label>
            <textarea
              value={referencedFilesRaw}
              onChange={(e) => setReferencedFilesRaw(e.target.value)}
              placeholder="src/lib/api.ts&#10;packages/server/src/index.ts"
              rows={3}
              className="w-full bg-zinc-900/50 border border-zinc-800/40 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-none font-mono transition-colors"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-zinc-100 text-zinc-900 hover:bg-zinc-200 rounded font-medium transition-colors"
            >
              Create Card
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
