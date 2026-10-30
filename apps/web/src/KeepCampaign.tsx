import { CharacterCard } from "@wyrd/core";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

export function KeepCampaign({ campaignId }: { campaignId: string }) {
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [cardId, setCardId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api("/character-cards", CharacterCard.array().parse)
      .then(setCards)
      .catch((e) => setError(e.message));
  }, []);
  async function save(path: string, note: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api(path, (x) => x, {});
      setMessage(note);
      setCards(await api("/character-cards", CharacterCard.array().parse));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="keep-campaign" aria-label="Keep this campaign">
      <h3>Keep this campaign</h3>
      <p>Keep a setup, this generated world, or your character for another adventure.</p>
      <div className="keep-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(`/campaigns/${campaignId}/world-setup`, "World setup saved.")}
        >
          Save as world setup
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(`/campaigns/${campaignId}/save-world`, "World saved.")}
        >
          Save this world
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(`/campaigns/${campaignId}/character-card`, "Character card saved.")}
        >
          Save character as card
        </button>
      </div>
      <label>
        Card to update
        <select
          aria-label="Card to update"
          value={cardId}
          disabled={busy}
          onChange={(e) => setCardId(e.target.value)}
        >
          <option value="">Choose a card</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !cardId}
        onClick={() => {
          if (
            window.confirm(
              "Replace this card's character and companions with this campaign's current character?",
            )
          )
            void save(`/character-cards/${cardId}/update-from/${campaignId}`, "Character card updated.");
        }}
      >
        Update card from this campaign
      </button>
      {busy && <p role="status">Saving to your library…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
