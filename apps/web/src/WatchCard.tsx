import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
} from "@mantine/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import {
  formatDate,
  formatDuration,
  formatIsoDay,
  formatPrice,
  relativeTime,
} from "./format";
import { HistoryChart } from "./HistoryChart";
import type { FlightLeg, PricePoint, WatchWithLatest } from "./types";

function Leg({ dir, leg }: { dir: "outbound" | "inbound"; leg: FlightLeg }) {
  const info = [
    leg.stops === 0 ? "direkt" : `${leg.stops} Stopp${leg.stops > 1 ? "s" : ""}`,
    leg.durationMin ? formatDuration(leg.durationMin) : null,
    leg.carrier,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="leg">
      <span className="leg-tag">{dir === "outbound" ? "Hin" : "Rück"}</span>
      <span className="mono">
        {leg.depAirport} {leg.depTime}
      </span>
      <span className="arrow">→</span>
      <span className="mono">
        {leg.arrTime} {leg.arrAirport}
      </span>
      <span className="dim">{info}</span>
    </div>
  );
}

export function WatchCard({
  watch,
  index,
  onChanged,
  onEdit,
}: {
  watch: WatchWithLatest;
  index: number;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<PricePoint[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [targetDraft, setTargetDraft] = useState<number | "">("");
  const [range, setRange] = useState("30");

  const shownHistory = useMemo(() => {
    if (!history) return null;
    if (range === "all") return history;
    const cutoff = Date.now() - Number(range) * 86_400_000;
    return history.filter((p) => new Date(p.checkedAt).getTime() >= cutoff);
  }, [history, range]);

  const loadHistory = useCallback(async () => {
    setHistory(await api.history(watch.id));
  }, [watch.id]);

  useEffect(() => {
    if (expanded && history === null) void loadHistory();
  }, [expanded, history, loadHistory]);

  const latest = watch.latest;
  const price = latest?.price ?? null;
  const delta =
    price !== null && watch.previousPrice !== null
      ? price - watch.previousPrice
      : null;
  const offer = latest?.offer;
  const bookingUrl = offer?.bookingUrl ?? null;
  const promos = offer
    ? offer.specials.filter((s) => !offer.priceIncludes.includes(s))
    : [];

  async function checkNow() {
    setChecking(true);
    try {
      await api.checkNow(watch.id);
      setHistory(null);
      onChanged();
      if (expanded) await loadHistory();
    } finally {
      setChecking(false);
    }
  }

  async function remove() {
    if (!confirm(`Reise "${watch.name}" wirklich löschen?`)) return;
    await api.deleteWatch(watch.id);
    onChanged();
  }

  async function togglePause() {
    await api.updateWatch(watch.id, { active: !watch.active });
    onChanged();
  }

  const target = watch.targetPrice;
  const reached = target !== null && price !== null && price <= target;

  async function saveTarget(value: number | null) {
    await api.updateWatch(watch.id, { targetPrice: value });
    setTargetModalOpen(false);
    onChanged();
  }

  function openTargetModal() {
    setTargetDraft(target ?? "");
    setTargetModalOpen(true);
  }

  return (
    <article className="watch-card" style={{ animationDelay: `${index * 55}ms` }}>
      <div className="card-top">
        <div style={{ minWidth: 0 }}>
          <h3 className="hotel-name">{watch.name}</h3>
          {offer && (offer.city || offer.region || offer.country) && (
            <p className="location">
              <span className="location-mark" aria-hidden="true" />
              {[offer.city, offer.region, offer.country]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <Group gap={6}>
            <Badge color="gray" variant="light" size="sm" radius="sm">
              {watch.mode === "cheapest" ? "Günstigster" : "Festes Angebot"}
            </Badge>
            {watch.stats?.isAllTimeLow && (
              <Badge color="teal" variant="light" size="sm" radius="sm">
                Bestpreis
              </Badge>
            )}
            {!watch.active && (
              <Badge color="gray" variant="outline" size="sm" radius="sm">
                pausiert
              </Badge>
            )}
            {reached && (
              <Badge color="teal" variant="light" size="sm" radius="sm">
                Wunschpreis erreicht
              </Badge>
            )}
            {target !== null && !reached && (
              <Badge color="gray" variant="light" size="sm" radius="sm">
                Ziel {formatPrice(target, latest?.currency ?? "EUR")}
              </Badge>
            )}
          </Group>
        </div>
        <div className="price-tag">
          <div className="price-value">
            {formatPrice(price, latest?.currency ?? null)}
          </div>
          {delta !== null && delta !== 0 && (
            <div className={`delta ${delta < 0 ? "down" : "up"}`}>
              {delta < 0 ? "↓" : "↑"}{" "}
              {formatPrice(Math.abs(delta), latest?.currency ?? null)}
            </div>
          )}
          <div className="price-pp">
            {offer
              ? `Endpreis · ${offer.travellers} ${offer.travellers === 1 ? "Person" : "Pers."}`
              : "Endpreis"}
          </div>
        </div>
      </div>

      {latest?.error && (
        <p style={{ color: "var(--up)", fontSize: 13, margin: "10px 0 0" }}>
          {latest.error}
        </p>
      )}

      {offer && (
        <>
          <div className="meta-line">
            <span>
              <b>
                {formatDate(offer.departureDate)} – {formatDate(offer.returnDate)}
              </b>{" "}
              · {offer.nights} Nächte
            </span>
            <span>{offer.tourOperator}</span>
            {offer.mealTypeName && <span>{offer.mealTypeName}</span>}
            {offer.roomName && <span>{offer.roomName}</span>}
          </div>

          <div className="breakdown">
            {offer.cashback > 0 && (
              <span>
                Gesamt {formatPrice(offer.totalPrice, offer.currency)} −{" "}
                {formatPrice(offer.cashback, offer.currency)} Cashback
              </span>
            )}
            <span>
              ≈ {formatPrice(Math.round(offer.effectiveTotal / offer.travellers), offer.currency)}
              /Person
            </span>
          </div>

          {(offer.flightOutbound || offer.flightInbound) && (
            <div className="flights">
              {offer.flightOutbound && (
                <Leg dir="outbound" leg={offer.flightOutbound} />
              )}
              {offer.flightInbound && (
                <Leg dir="inbound" leg={offer.flightInbound} />
              )}
            </div>
          )}

          <div className="chips">
            {offer.freeCancellationUntil ? (
              <span className="chip included">
                ✓ kostenlos stornierbar bis{" "}
                {formatIsoDay(offer.freeCancellationUntil)}
              </span>
            ) : (
              <span className="chip muted">keine kostenlose Storno</span>
            )}
            {promos.map((s) => (
                <span key={`s${s}`} className="chip">
                  {s}
                </span>
              ))}
              {offer.attributes.map((a) => (
                <span key={`a${a}`} className="chip">
                  {a}
                </span>
              ))}
              {offer.transferName && (
                <span className="chip">{offer.transferName}</span>
              )}
            </div>
        </>
      )}

      {watch.stats && watch.stats.count >= 2 && (
        <div className="stats-line">
          <span>
            Tief <b>{formatPrice(watch.stats.min, latest?.currency ?? "EUR")}</b>
          </span>
          <span>Ø {formatPrice(watch.stats.avg, latest?.currency ?? "EUR")}</span>
          <span>
            Hoch {formatPrice(watch.stats.max, latest?.currency ?? "EUR")}
          </span>
          {price !== null &&
            watch.stats.avg > 0 &&
            (() => {
              const pct = Math.round(((price - watch.stats!.avg) / watch.stats!.avg) * 100);
              if (pct === 0) return <span>im Schnitt</span>;
              return (
                <span className={pct < 0 ? "good" : "bad"}>
                  {Math.abs(pct)} % {pct < 0 ? "unter" : "über"} Ø
                </span>
              );
            })()}
        </div>
      )}

      <div className="card-foot">
        <span className="stamp">
          {latest
            ? `geprüft ${relativeTime(latest.checkedAt)} · ${latest.offersCount} Angebote`
            : "noch nicht geprüft"}
        </span>
        <div className="card-actions">
          <Button
            component="a"
            href={watch.url}
            target="_blank"
            rel="noreferrer"
            size="xs"
            className="primary-card-action"
          >
            <span className="label-wide">Suchauftrag öffnen</span>
            <span className="label-compact">Suche</span>
          </Button>
          {bookingUrl && (
            <Button
              component="a"
              href={bookingUrl}
              target="_blank"
              rel="noreferrer"
              variant="default"
              size="xs"
            >
              <span className="label-wide">Zur Buchung</span>
              <span className="label-compact">Buchung</span>
            </Button>
          )}
          <Button
            variant="default"
            size="xs"
            loading={checking}
            onClick={checkNow}
          >
            Jetzt prüfen
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            onClick={() => setExpanded((v) => !v)}
          >
            Verlauf
          </Button>
          <Menu position="bottom-end" withArrow shadow="md" radius="md">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Mehr">
                ⋯
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={openTargetModal}>
                {target !== null ? "Wunschpreis ändern…" : "Wunschpreis festlegen…"}
              </Menu.Item>
              <Menu.Item onClick={onEdit}>Bearbeiten</Menu.Item>
              <Menu.Item onClick={togglePause}>
                {watch.active ? "Pausieren" : "Fortsetzen"}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={remove}>
                Löschen
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      {expanded && (
        <div className="history-panel">
          <div className="history-head">
            <p className="section-label">Preisverlauf</p>
            {history && history.length > 0 && (
              <SegmentedControl
                size="xs"
                value={range}
                onChange={setRange}
                data={[
                  { label: "7 T", value: "7" },
                  { label: "30 T", value: "30" },
                  { label: "90 T", value: "90" },
                  { label: "Alles", value: "all" },
                ]}
              />
            )}
          </div>
          {shownHistory === null ? (
            <p className="stamp">Lade Verlauf…</p>
          ) : (
            <HistoryChart
              points={shownHistory}
              targetPrice={watch.targetPrice}
            />
          )}
        </div>
      )}

      <Modal
        opened={targetModalOpen}
        onClose={() => setTargetModalOpen(false)}
        title="Wunschpreis"
        radius="lg"
        centered
        size="sm"
      >
        <Stack gap="md">
          <NumberInput
            label="Wunschpreis (Endpreis, gesamt)"
            description="Push, sobald der Endpreis auf oder unter diesen Wert fällt"
            placeholder="z. B. 2400"
            value={targetDraft}
            onChange={(v) => setTargetDraft(typeof v === "number" ? v : "")}
            min={0}
            suffix=" €"
            thousandSeparator="."
            decimalSeparator=","
            allowNegative={false}
            data-autofocus
          />
          <Group justify="space-between">
            {target !== null ? (
              <Button
                variant="subtle"
                color="gray"
                onClick={() => saveTarget(null)}
              >
                Entfernen
              </Button>
            ) : (
              <span />
            )}
            <Button
              onClick={() =>
                saveTarget(typeof targetDraft === "number" ? targetDraft : null)
              }
            >
              Speichern
            </Button>
          </Group>
        </Stack>
      </Modal>
    </article>
  );
}
