# HolidayCheck Monitor

Überwacht Pauschalreisen-Angebote auf **HolidayCheck** und verfolgt
Preisänderungen samt Historie. Web-Dashboard mit Verlaufs-Chart, optionale
Push-Benachrichtigung via **Pushover** bei jeder Preisänderung.

## Wie es funktioniert

Für jede überwachte Reise wird die HolidayCheck-Angebots-URL regelmäßig per
Headless-Browser (**Playwright**) geladen. Die Preise stehen nicht im HTML,
sondern kommen über die interne `…/api/vacancies`-Schnittstelle – diese
JSON-Antworten werden abgefangen und ausgewertet. Cookie-Consent wird
automatisch bestätigt und die Sortierung auf „Preis" gestellt, damit der
günstigste Treffer zuverlässig geladen wird.

Zwei Modi pro Reise:

- **Günstigster im Zeitraum** (`cheapest`) – niedrigster Preis über alle
  Angebote, die die URL zurückgibt (ideal bei flexiblem Zeitraum).
- **Festes Angebot** (`fixed`) – ein bestimmtes Angebot, ausgewählt über
  Kriterien (Abreisedatum, Zimmer, Veranstalter, Verpflegungscode).

Jeder Check schreibt einen Datenpunkt (`price_points`) in eine lokale
**SQLite**-Datei. Weicht der Preis vom letzten bekannten ab, wird – sofern
konfiguriert – eine Pushover-Nachricht gesendet.

## Struktur (pnpm-Monorepo)

```
packages/core   – Datenmodell, SQLite, Scraper, Alerts, Scheduler
apps/server     – Fastify REST-API + Auslieferung des Frontends
apps/web        – React-Dashboard (Vite, Recharts)
```

## Setup

Voraussetzungen: Node ≥ 20, pnpm.

```bash
pnpm install                 # installiert Deps + lädt Chromium für Playwright
cp .env.example .env         # anschließend .env ausfüllen (siehe unten)
```

### Konfiguration (`.env`)

| Variable           | Bedeutung                                          | Default                        |
| ------------------ | -------------------------------------------------- | ------------------------------ |
| `PORT` / `HOST`    | Adresse des Servers                                | `3000` / `127.0.0.1`           |
| `DATABASE_PATH`    | Pfad zur SQLite-Datei                              | `./data/holidaycheck-monitor.sqlite`|
| `DEFAULT_CRON`     | Standard-Intervall neuer Watches                   | `0 */6 * * *` (alle 6 h)       |
| `PUSHOVER_TOKEN`   | Pushover-App-Token (leer = keine Pushes)           | –                              |
| `PUSHOVER_USER`    | Pushover-User-Key                                  | –                              |
| `SCRAPE_TIMEOUT_MS`| Timeout je Scrape                                  | `45000`                        |
| `HEADLESS`         | Browser headless (`false` zum Debuggen)            | `true`                         |

Pushover: unter <https://pushover.net> eine Application anlegen → `PUSHOVER_TOKEN`;
der `PUSHOVER_USER` steht im Dashboard. Ohne beide Werte werden Änderungen nur
in der Historie gespeichert, aber nicht gepusht.

## Entwicklung

```bash
pnpm dev:server   # Fastify auf :3000 (tsx watch)
pnpm dev:web      # Vite-Dashboard auf :5173 (proxyt /api → :3000)
```

Dashboard im Dev-Modus: <http://localhost:5173>

## Produktion

```bash
pnpm build        # core → server → web bauen
pnpm start        # Server auf :3000, liefert das gebaute Dashboard mit aus
```

Dann <http://localhost:3000> öffnen.

## Docker

```bash
docker build -t holidaycheck-monitor .
docker run --rm -p 3000:3000 -v holidaycheck-monitor-data:/data holidaycheck-monitor
```

Für Compose gibt es `docker-compose.yml` (hinter Caddy/tinyauth). Die
deployment-spezifischen Werte kommen aus einer `.env` daneben (git-ignoriert):

```bash
# .env anlegen:
#   CADDY_DOMAIN=holiday.example.com
#   CADDY_AUTH_GROUPS=larissa_und_tobias
#   PUSHOVER_TOKEN=...        # optional
#   PUSHOVER_USER=...         # optional
# image: ghcr.io/OWNER/holidaycheck-monitor:latest anpassen oder build: . aktivieren
docker compose up -d
```

Der Container lauscht auf `:3000` und speichert die SQLite-Datenbank unter
`/data/holidaycheck-monitor.sqlite`.

## Eine Reise überwachen

1. Auf HolidayCheck die gewünschte Pauschalreise mit Datum, Belegung und
   Abflughäfen zusammenstellen.
2. Die resultierende `…/package?_offer=…`-URL kopieren.
3. Im Dashboard **„Reise hinzufügen"**, URL einfügen, Modus wählen, anlegen.

Ein erster Check läuft direkt nach dem Anlegen; danach gemäß Cron-Intervall.

## API

| Methode  | Pfad                        | Zweck                                  |
| -------- | --------------------------- | -------------------------------------- |
| `GET`    | `/api/watches`              | Alle Watches inkl. aktuellem Preis     |
| `POST`   | `/api/watches`              | Watch anlegen (löst Erst-Check aus)    |
| `GET`    | `/api/watches/:id`          | Einzelne Watch                         |
| `PATCH`  | `/api/watches/:id`          | Watch ändern                           |
| `DELETE` | `/api/watches/:id`          | Watch löschen                          |
| `GET`    | `/api/watches/:id/history`  | Preis-Historie                         |
| `POST`   | `/api/watches/:id/check`    | Sofort prüfen                          |

## Hinweise

- Nur für den persönlichen Gebrauch. Die Scraping-Frequenz bewusst niedrig
  halten (Default alle 6 h).
- Die Zahl der pro Check erfassten Angebote kann leicht schwanken (dynamisches
  Nachladen der Seite); der getrackte Preis ist das Minimum der erfassten
  Angebote bzw. das Kriterien-Match.
```
