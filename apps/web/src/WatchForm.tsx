import {
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { api } from "./api";
import type {
  CreateWatchInput,
  MatchCriteria,
  WatchMode,
  WatchWithLatest,
} from "./types";

const INTERVALS = [
  { value: "*/30 * * * *", label: "alle 30 Minuten" },
  { value: "0 */3 * * *", label: "alle 3 Stunden" },
  { value: "0 */6 * * *", label: "alle 6 Stunden" },
  { value: "0 */12 * * *", label: "alle 12 Stunden" },
  { value: "0 8 * * *", label: "täglich (8 Uhr)" },
];
const CUSTOM = "__custom__";
const KNOWN = new Set(INTERVALS.map((i) => i.value));

export function WatchForm({
  opened,
  onClose,
  onSaved,
  watch,
}: {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  watch?: WatchWithLatest | null;
}) {
  const editing = !!watch;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<WatchMode>("cheapest");
  const [target, setTarget] = useState<number | "">("");
  const [interval, setInterval] = useState<string>("0 */6 * * *");
  const [cron, setCron] = useState("");
  const [crit, setCrit] = useState<MatchCriteria>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill whenever the modal opens (for edit) or resets (for add).
  useEffect(() => {
    if (!opened) return;
    setError(null);
    if (watch) {
      setName(watch.name);
      setUrl(watch.url);
      setMode(watch.mode);
      setTarget(watch.targetPrice ?? "");
      setCrit(watch.matchCriteria ?? {});
      if (KNOWN.has(watch.cron)) {
        setInterval(watch.cron);
        setCron("");
      } else {
        setInterval(CUSTOM);
        setCron(watch.cron);
      }
    } else {
      setName("");
      setUrl("");
      setMode("cheapest");
      setTarget("");
      setCrit({});
      setInterval("0 */6 * * *");
      setCron("");
    }
  }, [opened, watch]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const matchCriteria =
        mode === "fixed" && Object.values(crit).some(Boolean)
          ? (Object.fromEntries(
              Object.entries(crit).filter(([, v]) => v),
            ) as MatchCriteria)
          : null;
      const chosenCron = interval === CUSTOM ? cron.trim() : interval;
      const input: CreateWatchInput = {
        name,
        url,
        mode,
        matchCriteria,
        targetPrice: typeof target === "number" ? target : null,
        ...(chosenCron ? { cron: chosenCron } : {}),
      };
      if (editing && watch) await api.updateWatch(watch.id, input);
      else await api.createWatch(input);
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? "Reise bearbeiten" : "Neue Reise überwachen"}
      radius="lg"
      centered
      size="lg"
    >
      <form onSubmit={submit}>
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="z. B. Pilot Beach Resort, Kreta"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
          <TextInput
            label="HolidayCheck-URL"
            placeholder="https://www.holidaycheck.de/ho/…/package?_offer=…"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            required
          />
          <Group grow align="flex-start">
            <Select
              label="Modus"
              value={mode}
              onChange={(v) => setMode((v as WatchMode) ?? "cheapest")}
              allowDeselect={false}
              data={[
                { value: "cheapest", label: "Günstigster im Zeitraum" },
                { value: "fixed", label: "Festes Angebot (Kriterien)" },
              ]}
            />
            <Select
              label="Prüf-Intervall"
              value={interval}
              onChange={(v) => setInterval(v ?? "0 */6 * * *")}
              allowDeselect={false}
              data={[...INTERVALS, { value: CUSTOM, label: "eigener Cron…" }]}
            />
          </Group>

          {interval === CUSTOM && (
            <TextInput
              label="Cron-Ausdruck"
              placeholder="0 */6 * * *"
              value={cron}
              onChange={(e) => setCron(e.currentTarget.value)}
            />
          )}

          {mode === "fixed" && (
            <Group grow align="flex-start">
              <TextInput
                label="Abreisedatum"
                type="date"
                value={crit.departureDate ?? ""}
                onChange={(e) =>
                  setCrit({ ...crit, departureDate: e.currentTarget.value })
                }
              />
              <TextInput
                label="Zimmer enthält"
                placeholder="Double Superior"
                value={crit.roomName ?? ""}
                onChange={(e) =>
                  setCrit({ ...crit, roomName: e.currentTarget.value })
                }
              />
            </Group>
          )}
          {mode === "fixed" && (
            <Group grow align="flex-start">
              <TextInput
                label="Veranstalter enthält"
                placeholder="TUI"
                value={crit.tourOperator ?? ""}
                onChange={(e) =>
                  setCrit({ ...crit, tourOperator: e.currentTarget.value })
                }
              />
              <TextInput
                label="Verpflegungscode"
                placeholder="GT06-HB"
                value={crit.mealType ?? ""}
                onChange={(e) =>
                  setCrit({ ...crit, mealType: e.currentTarget.value })
                }
              />
            </Group>
          )}

          <NumberInput
            label="Wunschpreis – Endpreis gesamt (optional)"
            description="Push, sobald der Endpreis auf oder unter diesen Wert fällt"
            placeholder="z. B. 2400"
            value={target}
            onChange={(v) => setTarget(typeof v === "number" ? v : "")}
            min={0}
            suffix=" €"
            thousandSeparator="."
            decimalSeparator=","
            allowNegative={false}
          />

          {error && (
            <p style={{ color: "var(--up)", margin: 0, fontSize: 13 }}>
              {error}
            </p>
          )}

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onClose} type="button">
              Abbrechen
            </Button>
            <Button type="submit" loading={busy}>
              {editing ? "Speichern" : "Anlegen & prüfen"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
