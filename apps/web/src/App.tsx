import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { WatchCard } from "./WatchCard";
import { WatchForm } from "./WatchForm";
import type { WatchWithLatest } from "./types";

export function App() {
  const [watches, setWatches] = useState<WatchWithLatest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<WatchWithLatest | null>(null);

  const load = useCallback(async () => {
    try {
      setWatches(await api.listWatches());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  function openAdd() {
    setEditing(null);
    open();
  }
  function openEdit(w: WatchWithLatest) {
    setEditing(w);
    open();
  }

  const tracked = watches.length;

  return (
    <div className="app">
      <header className="head">
        <div>
          <h1>HolidayCheck Monitor</h1>
          <p className="sub">
            {tracked > 0
              ? `${tracked} ${tracked === 1 ? "Reise" : "Reisen"} beobachtet`
              : "Pauschalreisen-Preise im Blick"}
          </p>
        </div>
        <Button size="sm" onClick={openAdd}>
          Reise hinzufügen
        </Button>
      </header>

      <div className="divider" />

      {error && (
        <p style={{ color: "var(--up)", fontSize: 13 }}>Fehler: {error}</p>
      )}

      {loading ? (
        <p className="stamp">Lade…</p>
      ) : watches.length === 0 ? (
        <div className="empty">
          <h2>Noch keine Reise</h2>
          <p>
            Füge eine HolidayCheck-Angebots-URL hinzu, und der Monitor verfolgt
            den Preis samt Verlauf für dich.
          </p>
        </div>
      ) : (
        <div className="watch-list">
          {watches.map((w, i) => (
            <WatchCard
              key={w.id}
              watch={w}
              index={i}
              onChanged={load}
              onEdit={() => openEdit(w)}
            />
          ))}
        </div>
      )}

      <WatchForm
        opened={opened}
        onClose={close}
        onSaved={load}
        watch={editing}
      />
    </div>
  );
}
