"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Brain } from "lucide-react";
import { api, type AnkiCard } from "@/lib/api";
import { CardIndex } from "@/components/anki/card-index";
import { CardDetail } from "@/components/anki/card-detail";
import { NewCardModal } from "@/components/anki/new-card-modal";

export default function AnkiPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<AnkiCard | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshCards = useCallback(async () => {
    try {
      const data = await api.listAnkiCards(projectId);
      setCards(data);
      // Keep selected card in sync
      if (selectedCard) {
        const updated = data.find((c) => c.id === selectedCard.id);
        setSelectedCard(updated ?? null);
      }
    } catch (err) {
      console.error("Failed to load anki cards:", err);
    }
  }, [projectId, selectedCard]);

  useEffect(() => {
    setLoading(true);
    api
      .listAnkiCards(projectId)
      .then((data) => {
        setCards(data);
      })
      .catch((err) => console.error("Failed to load anki cards:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function handleCreate(data: {
    group: string;
    title: string;
    contents: string;
    referencedFiles: string[];
  }) {
    try {
      const newCard = await api.createAnkiCard(projectId, data);
      setShowNew(false);
      await refreshCards();
      setSelectedCard(newCard);
    } catch (err) {
      console.error("Failed to create card:", err);
    }
  }

  async function handleUpdate(
    cardId: string,
    data: Partial<{ group: string; title: string; contents: string; referencedFiles: string[] }>
  ) {
    try {
      const updated = await api.updateAnkiCard(projectId, cardId, data);
      setSelectedCard(updated);
      await refreshCards();
    } catch (err) {
      console.error("Failed to update card:", err);
    }
  }

  async function handleDelete(cardId: string) {
    try {
      await api.deleteAnkiCard(projectId, cardId);
      setSelectedCard(null);
      await refreshCards();
    } catch (err) {
      console.error("Failed to delete card:", err);
    }
  }

  const existingGroups = Array.from(new Set(cards.map((c) => c.group))).sort();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: card index */}
      <div className="w-[280px] shrink-0 overflow-hidden">
        <CardIndex
          cards={cards}
          selectedId={selectedCard?.id ?? null}
          onSelect={setSelectedCard}
          onNewCard={() => setShowNew(true)}
        />
      </div>

      {/* Right panel: card detail or empty state */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedCard ? (
          <CardDetail
            card={selectedCard}
            onUpdate={(data) => handleUpdate(selectedCard.id, data)}
            onDelete={() => handleDelete(selectedCard.id)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-14 h-14 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
              <Brain className="h-6 w-6 text-violet-500/60" />
            </div>
            <p className="text-sm text-zinc-400 mb-1">
              {cards.length === 0
                ? "No knowledge cards yet"
                : "Select a card to view details"}
            </p>
            <p className="text-xs text-zinc-600">
              {cards.length === 0
                ? "Create a card to capture important context for your agents."
                : "Or create a new card with the button in the sidebar."}
            </p>
          </div>
        )}
      </div>

      {/* New card modal */}
      {showNew && (
        <NewCardModal
          existingGroups={existingGroups}
          onSave={handleCreate}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
