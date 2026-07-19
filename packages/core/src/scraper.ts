import { chromium, type Browser, type Page } from "playwright";
import { loadConfig } from "./config.js";
import type { FlightLeg, MatchCriteria, Offer, WatchMode } from "./types.js";

export interface ScrapeResult {
  offers: Offer[];
  /** The offer selected according to mode/criteria, or null if none matched. */
  selected: Offer | null;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

/** Endpoints that carry package-offer prices. */
const OFFER_API = /\/api\/(vacanc|all-offers-service)/;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const { headless } = loadConfig();
    browserPromise = chromium.launch({ headless });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIsoDate(d: unknown): string {
  if (
    d &&
    typeof d === "object" &&
    "year" in d &&
    "month" in d &&
    "day" in d
  ) {
    const o = d as { year: number; month: number; day: number };
    return `${o.year}-${pad2(o.month)}-${pad2(o.day)}`;
  }
  return "";
}

/** Summarise a flight leg (array of segments) into a single FlightLeg. */
function parseLeg(
  segments: unknown,
  stops: unknown,
  duration: unknown,
): FlightLeg | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const first = segments[0] as Record<string, unknown>;
  const last = segments[segments.length - 1] as Record<string, unknown>;
  const dep = (first.departure ?? {}) as Record<string, unknown>;
  const arr = (last.arrival ?? {}) as Record<string, unknown>;
  const depAp = (first.departureAirport ?? {}) as Record<string, unknown>;
  const arrAp = (last.arrivalAirport ?? {}) as Record<string, unknown>;
  const carrier = (first.carrier ?? {}) as Record<string, unknown>;
  const dur = (duration ?? {}) as { hours?: unknown; minutes?: unknown };
  const durationMin =
    (typeof dur.hours === "number" ? dur.hours * 60 : 0) +
    (typeof dur.minutes === "number" ? dur.minutes : 0);
  return {
    date: typeof dep.date === "string" ? dep.date : "",
    depTime: typeof dep.time === "string" ? dep.time : "",
    depAirport: typeof depAp.code === "string" ? depAp.code : "",
    arrTime: typeof arr.time === "string" ? arr.time : "",
    arrAirport: typeof arrAp.code === "string" ? arrAp.code : "",
    durationMin,
    stops: typeof stops === "number" ? stops : 0,
    carrier: typeof carrier.name === "string" ? carrier.name : null,
  };
}

/** Defensively map one raw vacancy-API offer object to our Offer shape. */
function parseOffer(raw: unknown): Offer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const price = o.pricePerPerson as { amount?: unknown; currency?: unknown } | undefined;
  const amount = price?.amount;
  if (typeof amount !== "number") return null;

  const room = (o.room ?? {}) as Record<string, unknown>;
  const provider = (o.providerRawData ?? {}) as Record<string, unknown>;
  const operator = (o.tourOperator ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;

  const attributes = (Array.isArray(o.attributes) ? o.attributes : [])
    .map((a) => (a && typeof a === "object" ? str((a as Record<string, unknown>).description) : null))
    .filter((d): d is string => d !== null);

  const flight = (o.flight ?? {}) as Record<string, unknown>;
  const flightInfo = (o.flightInfo ?? {}) as Record<string, unknown>;
  const outbound0 = (Array.isArray(flightInfo.outbound) ? flightInfo.outbound[0] : undefined) as
    | Record<string, unknown>
    | undefined;
  const carrier = (outbound0?.carrier ?? {}) as Record<string, unknown>;

  // Promo labels, minus cashback ads (those come from the reliable price
  // breakdown below and would otherwise show a confusing second number).
  const specials = (Array.isArray(o.specials) ? o.specials : [])
    .map((s) => {
      const texts = (s as Record<string, unknown>)?.specialTexts;
      const label = Array.isArray(texts)
        ? (texts.find(
            (t) => (t as Record<string, unknown>)?.key === "label",
          ) as Record<string, unknown> | undefined)
        : undefined;
      return str(label?.text);
    })
    .filter((l): l is string => l !== null && !/cashback/i.test(l));

  // Real, offer-specific cashback/vouchers from the price breakdown. These are
  // credited back after booking, so we subtract them to get the effective price.
  const cashbackItems = (Array.isArray(o.priceBreakdown) ? o.priceBreakdown : [])
    .map((b) => b as Record<string, unknown>)
    .filter(
      (b) =>
        b.included === true &&
        /CASH_BACK|VOUCHER|DISCOUNT/i.test(
          typeof b.type === "string" ? b.type : "",
        ),
    );
  let cashback = 0;
  const priceIncludes: string[] = [];
  for (const b of cashbackItems) {
    const amt = (b.price as { amount?: unknown } | undefined)?.amount;
    if (typeof amt === "number") cashback += amt;
    const l = str(b.label);
    if (l) priceIncludes.push(l);
  }

  const cancel = (o.cancellationInformation ?? {}) as Record<string, unknown>;
  const freeCancellationUntil =
    str(cancel.freeCancellationUntilISO) ?? str(cancel.freeCancellationUntil);

  const travellers = Array.isArray(o.travellers)
    ? o.travellers.length
    : typeof o.adults === "number"
      ? o.adults
      : 1;
  const totalRaw = (o.totalPrice as { amount?: unknown } | undefined)?.amount;
  const totalPrice =
    typeof totalRaw === "number" ? totalRaw : amount * (travellers || 1);
  const effectiveTotal = Math.max(0, totalPrice - cashback);

  const flightOutbound = parseLeg(
    flightInfo.outbound,
    flightInfo.outboundStops,
    flightInfo.outboundDuration,
  );
  const flightInbound = parseLeg(
    flightInfo.inbound,
    flightInfo.inboundStops,
    flightInfo.inboundDuration,
  );

  return {
    pricePerPerson: amount,
    totalPrice,
    cashback,
    effectiveTotal,
    travellers: travellers || 1,
    freeCancellationUntil,
    currency: typeof price?.currency === "string" ? price.currency : "EUR",
    departureDate: toIsoDate(o.departureDate),
    returnDate: toIsoDate(o.returnDate),
    nights: typeof o.nights === "number" ? o.nights : 0,
    roomName: str(room.name) ?? "",
    mealType: str(o.mealType) ?? "",
    mealTypeName: str(o.mealTypeName) ?? "",
    tourOperator: str(operator.name) ?? "",
    bookingCode: str(provider.bookingCode),
    attributes,
    transferName: str(o.transferName),
    directFlight: o.directFlight === true,
    departureAirport: str(flight.departureAirportName),
    departureAirportCode: str(flight.departureAirport),
    airline: str(carrier.name),
    specials,
    priceIncludes,
    flightOutbound,
    flightInbound,
  };
}

/**
 * Extract the canonical offer list from an offer-API response. We read the
 * result list explicitly (rather than grabbing every `pricePerPerson` in the
 * payload) so we ignore ads/bundles/facet samples and get a deterministic
 * count. Known shapes:
 *   - /api/all-offers-service    → { data: { offers: [offer, …], sponsoredOffers, … } }
 *   - /api/vacancies;offerIds=…  → { data: [offer] }
 *   - /api/vacancy-pilot         → { data: { id, info, … } }  (no offers → [])
 */
function extractOffers(json: unknown): unknown[] {
  const data = (json as { data?: unknown })?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const offers = (data as { offers?: unknown }).offers;
    if (Array.isArray(offers)) return offers;
    if ("pricePerPerson" in (data as object)) return [data];
    return [];
  }
  if (Array.isArray(data)) return data;
  return [];
}

/** Best-effort: accept the Sourcepoint consent dialog so the offer API fires. */
async function dismissConsent(page: Page): Promise<void> {
  const labels = /alle akzeptieren|akzeptieren|zustimmen|accept all|accept/i;
  const frame = page
    .frameLocator('iframe[title*="Consent" i], iframe[id*="sp_message" i]')
    .getByRole("button", { name: labels })
    .first();
  try {
    await frame.click({ timeout: 2500 });
    return;
  } catch {
    // Fall through: try a plain in-page button.
  }
  try {
    await page
      .getByRole("button", { name: labels })
      .first()
      .click({ timeout: 1500 });
  } catch {
    // No banner / already consented — continue.
  }
}

function selectOffer(
  offers: Offer[],
  mode: WatchMode,
  criteria: MatchCriteria | null,
): Offer | null {
  if (offers.length === 0) return null;

  const cheapest = (list: Offer[]): Offer | null =>
    list.reduce<Offer | null>(
      (min, o) =>
        min === null || o.effectiveTotal < min.effectiveTotal ? o : min,
      null,
    );

  if (mode === "cheapest") return cheapest(offers);

  // fixed: filter by criteria, then take the cheapest remaining match.
  const c = criteria ?? {};
  const matches = offers.filter((o) => {
    if (c.departureDate && o.departureDate !== c.departureDate) return false;
    if (
      c.roomName &&
      !o.roomName.toLowerCase().includes(c.roomName.toLowerCase())
    )
      return false;
    if (c.mealType && o.mealType.toLowerCase() !== c.mealType.toLowerCase())
      return false;
    if (
      c.tourOperator &&
      !o.tourOperator.toLowerCase().includes(c.tourOperator.toLowerCase())
    )
      return false;
    return true;
  });
  return cheapest(matches);
}

const offerKey = (o: Offer): string =>
  `${o.departureDate}|${o.returnDate}|${o.roomName}|${o.mealType}|${o.pricePerPerson}`;

/**
 * Load the URL once in a fresh browser context and return the offers found.
 * A fresh context matters: HolidayCheck non-deterministically serves a partial
 * (cached) offer list for the same URL that can omit the cheapest offer. Reusing
 * a context returns the same cached partial every time; independent contexts get
 * independent draws, so running several and taking the union recovers the full
 * list — no need to scrape "all" pages, just to catch one complete response.
 */
async function loadOffersOnce(
  browser: Browser,
  url: string,
  timeoutMs: number,
): Promise<Offer[]> {
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const byKey = new Map<string, Offer>();
  let lastHit = 0;

  page.on("response", (resp) => {
    if (!OFFER_API.test(resp.url())) return;
    void resp
      .json()
      .then((j: unknown) => {
        for (const raw of extractOffers(j)) {
          const offer = parseOffer(raw);
          if (!offer) continue;
          byKey.set(offerKey(offer), offer);
          lastHit = Date.now();
        }
      })
      .catch(() => {
        /* non-JSON response — ignore */
      });
  });

  try {
    const deadline = Date.now() + timeoutMs;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    void dismissConsent(page); // offers load without it, but just in case
    // Wait for the offer response to arrive, then a short idle to let it finish.
    while (Date.now() < deadline) {
      const idleFor = lastHit === 0 ? Infinity : Date.now() - lastHit;
      if (byKey.size > 0 && idleFor > 1500) break;
      await page.waitForTimeout(300);
    }
  } catch {
    /* navigation error — return whatever we captured */
  } finally {
    await context.close();
  }
  return [...byKey.values()];
}

/**
 * Load a HolidayCheck package-offer URL and extract the offers, then pick one
 * per mode/criteria. Runs several independent loads in parallel and unions the
 * results to defeat HolidayCheck's partial-list caching (see loadOffersOnce).
 */
export async function scrapeOffers(
  url: string,
  mode: WatchMode,
  criteria: MatchCriteria | null,
): Promise<ScrapeResult> {
  const { scrapeTimeoutMs, scrapeAttempts } = loadConfig();
  const browser = await getBrowser();

  const attempts = await Promise.all(
    Array.from({ length: scrapeAttempts }, () =>
      loadOffersOnce(browser, url, scrapeTimeoutMs).catch(() => [] as Offer[]),
    ),
  );

  const byKey = new Map<string, Offer>();
  for (const offers of attempts) {
    for (const o of offers) byKey.set(offerKey(o), o);
  }
  const merged = [...byKey.values()].sort(
    (a, b) => a.effectiveTotal - b.effectiveTotal,
  );
  return { offers: merged, selected: selectOffer(merged, mode, criteria) };
}
