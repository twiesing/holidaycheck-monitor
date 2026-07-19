import { nanoid } from "nanoid";
import { sendPush } from "./alerts.js";
import { loadConfig } from "./config.js";
import { getDb } from "./db.js";
import { scrapeOffers } from "./scraper.js";
import {
  createWatchSchema,
  updateWatchSchema,
  type CreateWatchInput,
  type Offer,
  type PricePoint,
  type UpdateWatchInput,
  type Watch,
} from "./types.js";

interface WatchRow {
  id: string;
  name: string;
  url: string;
  mode: string;
  match_criteria: string | null;
  target_price: number | null;
  cron: string;
  active: number;
  created_at: string;
}

interface PricePointRow {
  id: string;
  watch_id: string;
  checked_at: string;
  price: number | null;
  currency: string | null;
  offer: string | null;
  offers_count: number;
  error: string | null;
  changed: number;
}

function rowToWatch(r: WatchRow): Watch {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    mode: r.mode === "fixed" ? "fixed" : "cheapest",
    matchCriteria: r.match_criteria ? JSON.parse(r.match_criteria) : null,
    targetPrice: r.target_price,
    cron: r.cron,
    active: r.active === 1,
    createdAt: r.created_at,
  };
}

function rowToPoint(r: PricePointRow): PricePoint {
  return {
    id: r.id,
    watchId: r.watch_id,
    checkedAt: r.checked_at,
    price: r.price,
    currency: r.currency,
    offer: r.offer ? (JSON.parse(r.offer) as Offer) : null,
    offersCount: r.offers_count,
    error: r.error,
    changed: r.changed === 1,
  };
}

export function listWatches(): Watch[] {
  const rows = getDb()
    .prepare("SELECT * FROM watches ORDER BY created_at DESC")
    .all() as WatchRow[];
  return rows.map(rowToWatch);
}

export function getWatch(id: string): Watch | null {
  const row = getDb()
    .prepare("SELECT * FROM watches WHERE id = ?")
    .get(id) as WatchRow | undefined;
  return row ? rowToWatch(row) : null;
}

export function createWatch(input: CreateWatchInput): Watch {
  const data = createWatchSchema.parse(input);
  const watch: Watch = {
    id: nanoid(),
    name: data.name,
    url: data.url,
    mode: data.mode,
    matchCriteria: data.matchCriteria,
    targetPrice: data.targetPrice,
    cron: data.cron ?? loadConfig().defaultCron,
    active: data.active,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO watches (id, name, url, mode, match_criteria, target_price, cron, active, created_at)
       VALUES (@id, @name, @url, @mode, @match_criteria, @target_price, @cron, @active, @created_at)`,
    )
    .run({
      id: watch.id,
      name: watch.name,
      url: watch.url,
      mode: watch.mode,
      match_criteria: watch.matchCriteria
        ? JSON.stringify(watch.matchCriteria)
        : null,
      target_price: watch.targetPrice,
      cron: watch.cron,
      active: watch.active ? 1 : 0,
      created_at: watch.createdAt,
    });
  return watch;
}

export function updateWatch(id: string, input: UpdateWatchInput): Watch | null {
  const existing = getWatch(id);
  if (!existing) return null;
  const data = updateWatchSchema.parse(input);
  const merged: Watch = {
    ...existing,
    ...("name" in data && data.name !== undefined ? { name: data.name } : {}),
    ...("url" in data && data.url !== undefined ? { url: data.url } : {}),
    ...("mode" in data && data.mode !== undefined ? { mode: data.mode } : {}),
    ...("matchCriteria" in data
      ? { matchCriteria: data.matchCriteria ?? null }
      : {}),
    ...("targetPrice" in data
      ? { targetPrice: data.targetPrice ?? null }
      : {}),
    ...("cron" in data && data.cron !== undefined ? { cron: data.cron } : {}),
    ...("active" in data && data.active !== undefined
      ? { active: data.active }
      : {}),
  };
  getDb()
    .prepare(
      `UPDATE watches SET name=@name, url=@url, mode=@mode, match_criteria=@match_criteria,
       target_price=@target_price, cron=@cron, active=@active WHERE id=@id`,
    )
    .run({
      id,
      name: merged.name,
      url: merged.url,
      mode: merged.mode,
      match_criteria: merged.matchCriteria
        ? JSON.stringify(merged.matchCriteria)
        : null,
      target_price: merged.targetPrice,
      cron: merged.cron,
      active: merged.active ? 1 : 0,
    });
  return merged;
}

export function deleteWatch(id: string): boolean {
  const res = getDb().prepare("DELETE FROM watches WHERE id = ?").run(id);
  return res.changes > 0;
}

export function listHistory(watchId: string, limit = 500): PricePoint[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM price_points WHERE watch_id = ?
       ORDER BY checked_at ASC LIMIT ?`,
    )
    .all(watchId, limit) as PricePointRow[];
  return rows.map(rowToPoint);
}

/** Latest recorded point that carried an actual price (ignores error points). */
function lastPricedPoint(watchId: string): PricePointRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM price_points WHERE watch_id = ? AND price IS NOT NULL
       ORDER BY checked_at DESC LIMIT 1`,
    )
    .get(watchId) as PricePointRow | undefined;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

function formatPrice(price: number, currency: string): string {
  return `${price.toLocaleString("de-DE")} ${currency === "EUR" ? "€" : currency}`;
}

/**
 * Run the scraper for a watch, record a price point, and push a notification
 * if the price changed versus the last known price.
 */
export async function checkWatch(watch: Watch): Promise<PricePoint> {
  const checkedAt = new Date().toISOString();
  let price: number | null = null;
  let currency: string | null = null;
  let offer: Offer | null = null;
  let offersCount = 0;
  let error: string | null = null;

  try {
    const result = await scrapeOffers(
      watch.url,
      watch.mode,
      watch.matchCriteria,
    );
    offersCount = result.offers.length;
    offer = result.selected;
    if (offer) {
      price = offer.effectiveTotal;
      currency = offer.currency;
    } else {
      error =
        offersCount === 0
          ? "Keine Angebote gefunden (evtl. ausgebucht oder Seite geändert)"
          : "Kein Angebot passt zu den Kriterien";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const prev = lastPricedPoint(watch.id);
  const prevPrice = prev?.price ?? null;
  const changed =
    price !== null && prevPrice !== null && price !== prevPrice;
  const target = watch.targetPrice;
  // Fire once when the price crosses down to/under the wish price.
  const reachedTarget =
    target !== null &&
    price !== null &&
    price <= target &&
    (prevPrice === null || prevPrice > target);

  const point: PricePoint = {
    id: nanoid(),
    watchId: watch.id,
    checkedAt,
    price,
    currency,
    offer,
    offersCount,
    error,
    changed,
  };

  getDb()
    .prepare(
      `INSERT INTO price_points
        (id, watch_id, checked_at, price, currency, offer, offers_count, error, changed)
       VALUES (@id, @watch_id, @checked_at, @price, @currency, @offer, @offers_count, @error, @changed)`,
    )
    .run({
      id: point.id,
      watch_id: point.watchId,
      checked_at: point.checkedAt,
      price: point.price,
      currency: point.currency,
      offer: point.offer ? JSON.stringify(point.offer) : null,
      offers_count: point.offersCount,
      error: point.error,
      changed: point.changed ? 1 : 0,
    });

  const detail = offer
    ? ` · ${formatDate(offer.departureDate)}–${formatDate(offer.returnDate)} · ${offer.tourOperator}`
    : "";

  // Only notify when the wish price is reached (no generic change alerts).
  if (reachedTarget && price !== null && currency !== null && target !== null) {
    await sendPush({
      title: `🎯 Wunschpreis erreicht: ${watch.name}`,
      message:
        `${formatPrice(price, currency)} ` +
        `(Wunschpreis ${formatPrice(target, currency)})` +
        detail,
      url: offer?.bookingUrl ?? watch.url,
      urlTitle: offer?.bookingUrl
        ? "Freie Plätze prüfen"
        : "Angebot auf HolidayCheck öffnen",
    });
  }

  return point;
}
