import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatPrice } from "./format";
import { WatchCard } from "./WatchCard";
import { WatchForm } from "./WatchForm";
import type { WatchWithLatest } from "./types";

interface CountryGroup {
  country: string;
  watches: WatchWithLatest[];
  cheapest: number | null;
  currency: string | null;
}

function groupByCountry(watches: WatchWithLatest[]): CountryGroup[] {
  const map = new Map<string, WatchWithLatest[]>();
  for (const w of watches) {
    const country = w.latest?.offer?.country ?? "Ohne Land";
    (map.get(country) ?? map.set(country, []).get(country)!).push(w);
  }
  const groups: CountryGroup[] = [...map.entries()].map(([country, ws]) => {
    const prices = ws
      .map((w) => w.latest?.price)
      .filter((p): p is number => typeof p === "number");
    return {
      country,
      watches: [...ws].sort(
        (a, b) => (a.latest?.price ?? Infinity) - (b.latest?.price ?? Infinity),
      ),
      cheapest: prices.length ? Math.min(...prices) : null,
      currency: ws.find((w) => w.latest?.currency)?.latest?.currency ?? "EUR",
    };
  });
  // Real countries A→Z, "Ohne Land" last.
  return groups.sort((a, b) => {
    if (a.country === "Ohne Land") return 1;
    if (b.country === "Ohne Land") return -1;
    return a.country.localeCompare(b.country, "de");
  });
}

export function App() {
  const [watches, setWatches] = useState<WatchWithLatest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [editing, setEditing] = useState<WatchWithLatest | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupByCountry(watches), [watches]);

  function toggleGroup(country: string) {
    setCollapsed((c) => ({ ...c, [country]: !(c[country] ?? true) }));
  }

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
        <div className="groups">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.country] ?? true;
            return (
              <section className="country-group" key={g.country}>
                <button
                  className="group-head"
                  onClick={() => toggleGroup(g.country)}
                  aria-expanded={!isCollapsed}
                >
                  <svg
                    className={`group-chevron ${isCollapsed ? "" : "open"}`}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  <span className="group-title">{g.country}</span>
                  <span className="group-preview">
                    {g.watches.length}{" "}
                    {g.watches.length === 1 ? "Reise" : "Reisen"}
                    {g.cheapest !== null && (
                      <> · ab {formatPrice(g.cheapest, g.currency)}</>
                    )}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="watch-list">
                    {g.watches.map((w, i) => (
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
              </section>
            );
          })}
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
