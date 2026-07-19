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

function absoluteUrl(value: string, baseUrl: string): string | null {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function hotelSlugFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = parts[0] === "ho" ? parts[1] : null;
    return slug ? slug.replace(/^angebote-/, "") : null;
  } catch {
    return null;
  }
}

function hotelIdFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[0] === "ho" && parts[2] ? parts[2] : null;
  } catch {
    return null;
  }
}

function bookingUrl(raw: Record<string, unknown>, sourceUrl: string): string | null {
  const clickOut = raw.clickOutUrl;
  if (typeof clickOut === "string" && clickOut.length > 0) {
    return absoluteUrl(clickOut, sourceUrl);
  }

  const offerId = raw.offerId;
  if (typeof offerId !== "string" || offerId.length === 0) return null;

  const provider = (raw.providerRawData ?? {}) as Record<string, unknown>;
  const hotelId =
    typeof raw.hotelId === "string" ? raw.hotelId : hotelIdFromUrl(sourceUrl);
  const hotelName = hotelSlugFromUrl(sourceUrl);
  const tourOperator =
    typeof provider.tourOperatorCode === "string"
      ? provider.tourOperatorCode
      : null;

  const url = new URL(`/wbf/booking/${offerId}`, sourceUrl);
  url.searchParams.set("ctx", "hotel-offerlist");
  if (hotelId) url.searchParams.set("hotelid", hotelId);
  if (hotelName) url.searchParams.set("hotelname", hotelName);
  url.searchParams.set("sorting", "recommendationPrice");
  if (tourOperator) url.searchParams.set("tourOperator", tourOperator);
  url.searchParams.set("travelkind", "package");
  return url.toString();
}

/** Defensively map one raw vacancy-API offer object to our Offer shape. */
function parseOffer(raw: unknown, sourceUrl: string): Offer | null {
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

  const specialsRaw = (Array.isArray(o.specials) ? o.specials : []).map(
    (s) => s as Record<string, unknown>,
  );
  const specialLabel = (s: Record<string, unknown>): string | null => {
    const texts = s.specialTexts;
    const label = Array.isArray(texts)
      ? (texts.find(
          (t) => (t as Record<string, unknown>)?.key === "label",
        ) as Record<string, unknown> | undefined)
      : undefined;
    return str(label?.text);
  };
  const isCashback = (s: Record<string, unknown>): boolean =>
    /CASH_BACK/i.test(typeof s.specialType === "string" ? s.specialType : "");

  // Cashback = all cashback specials, summing their structured discount amount.
  // HolidayCheck stacks several (e.g. a PERSONAL_CASH_BACK + a CASH_BACK_VOUCHER)
  // and subtracts the sum from the gross total — matching the site's final price.
  let cashback = 0;
  const priceIncludes: string[] = [];
  for (const s of specialsRaw.filter(isCashback)) {
    const amt = (s.discount as { amount?: unknown } | undefined)?.amount;
    if (typeof amt === "number") cashback += amt;
    const l = specialLabel(s);
    if (l) priceIncludes.push(l);
  }

  // Promo labels (non-cashback specials, e.g. "TUI Flashsale") for display only.
  const specials = specialsRaw
    .filter((s) => !isCashback(s))
    .map(specialLabel)
    .filter((l): l is string => l !== null);

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
    city: null, // stamped from the page's schema.org data in scrapeOffers
    region: null,
    country: null,
    currency: typeof price?.currency === "string" ? price.currency : "EUR",
    departureDate: toIsoDate(o.departureDate),
    returnDate: toIsoDate(o.returnDate),
    nights: typeof o.nights === "number" ? o.nights : 0,
    roomName: str(room.name) ?? "",
    mealType: str(o.mealType) ?? "",
    mealTypeName: str(o.mealTypeName) ?? "",
    tourOperator: str(operator.name) ?? "",
    bookingCode: str(provider.bookingCode),
    bookingUrl: bookingUrl(o, sourceUrl),
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

interface HotelLocation {
  city: string | null;
  region: string | null;
  country: string | null;
}

/** Read the hotel's location from the page's schema.org (JSON-LD) markup. */
async function readLocation(page: Page): Promise<HotelLocation | null> {
  try {
    return await page.evaluate(() => {
      // Runs in the browser; core has no DOM lib types, so reach document via
      // globalThis and treat it structurally.
      const d = (globalThis as unknown as { document: {
        querySelectorAll: (s: string) => ArrayLike<{ textContent: string | null }>;
      } }).document;
      const nodes = Array.prototype.slice.call(
        d.querySelectorAll('script[type="application/ld+json"]'),
      ) as { textContent: string | null }[];
      for (const s of nodes) {
        try {
          const j = JSON.parse(s.textContent || "");
          for (const item of Array.isArray(j) ? j : [j]) {
            const a = item?.address;
            if (a && (a.addressLocality || a.addressCountry)) {
              return {
                city: a.addressLocality ?? null,
                region: a.addressRegion ?? null,
                country: a.addressCountry ?? null,
              };
            }
          }
        } catch {
          /* ignore malformed JSON-LD */
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

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
): Promise<{ offers: Offer[]; location: HotelLocation | null }> {
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
          const offer = parseOffer(raw, url);
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
    const location = await readLocation(page);
    return { offers: [...byKey.values()], location };
  } catch {
    /* navigation error — return whatever we captured */
    return { offers: [...byKey.values()], location: null };
  } finally {
    await context.close();
  }
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
      loadOffersOnce(browser, url, scrapeTimeoutMs).catch(() => ({
        offers: [] as Offer[],
        location: null as HotelLocation | null,
      })),
    ),
  );

  const byKey = new Map<string, Offer>();
  let location: HotelLocation | null = null;
  for (const attempt of attempts) {
    for (const o of attempt.offers) byKey.set(offerKey(o), o);
    if (!location && attempt.location) location = attempt.location;
  }
  // Stamp the hotel location onto every offer so the selected one carries it.
  if (location) {
    for (const o of byKey.values()) {
      o.city = location.city;
      o.region = location.region;
      o.country = location.country;
    }
  }
  const merged = [...byKey.values()].sort(
    (a, b) => a.effectiveTotal - b.effectiveTotal,
  );
  return { offers: merged, selected: selectOffer(merged, mode, criteria) };
}
