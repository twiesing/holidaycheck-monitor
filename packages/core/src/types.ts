import { z } from "zod";

/**
 * A watch tracks one HolidayCheck package-offer URL.
 * - "cheapest": track the lowest price across all offers the URL returns
 *   (useful when the URL spans a flexible date range).
 * - "fixed": track one specific offer selected via matchCriteria.
 */
export const watchModeSchema = z.enum(["cheapest", "fixed"]);
export type WatchMode = z.infer<typeof watchModeSchema>;

/**
 * Criteria to pin a single offer in "fixed" mode. All provided fields must
 * match (case-insensitive substring for text fields, exact for the date).
 */
export const matchCriteriaSchema = z.object({
  /** Departure date as ISO yyyy-mm-dd, e.g. "2026-09-20". */
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Substring of the room name, e.g. "Double Superior". */
  roomName: z.string().min(1).optional(),
  /** HolidayCheck meal-type code, e.g. "GT06-HB" (half board). */
  mealType: z.string().min(1).optional(),
  /** Substring of the tour operator name, e.g. "TUI". */
  tourOperator: z.string().min(1).optional(),
});
export type MatchCriteria = z.infer<typeof matchCriteriaSchema>;

/** One flight leg (outbound or inbound), summarised from flightInfo. */
export interface FlightLeg {
  date: string; // "16.09.2026"
  depTime: string; // "05:20"
  depAirport: string; // "HAJ"
  arrTime: string; // "09:35"
  arrAirport: string; // "HER"
  durationMin: number;
  stops: number;
  carrier: string | null;
}

/** A single offer parsed from HolidayCheck's vacancy API. */
export interface Offer {
  /** HolidayCheck's advertised "ab" price per person (headline number). */
  pricePerPerson: number;
  /** Gross total for the whole booking (sum of all travellers). */
  totalPrice: number;
  /** Cashback / vouchers credited back after booking. */
  cashback: number;
  /** What you effectively pay: totalPrice − cashback. This is what we track. */
  effectiveTotal: number;
  /** Number of travellers the total covers. */
  travellers: number;
  /** ISO datetime until which free cancellation is possible, or null. */
  freeCancellationUntil: string | null;
  currency: string;
  departureDate: string; // ISO yyyy-mm-dd
  returnDate: string; // ISO yyyy-mm-dd
  nights: number;
  roomName: string;
  mealType: string; // code, e.g. "GT06-HB"
  mealTypeName: string; // human-readable, e.g. "Halbpension"
  tourOperator: string;
  bookingCode: string | null;
  /** Included extras, e.g. "inkl. Zug zum Flug". */
  attributes: string[];
  /** Transfer note, e.g. "inkl. Hoteltransfer". */
  transferName: string | null;
  directFlight: boolean;
  /** Departure airport name, e.g. "Hannover-Langenhagen". */
  departureAirport: string | null;
  /** Departure airport IATA code, e.g. "HAJ" (used to deep-link the offer). */
  departureAirportCode: string | null;
  /** Outbound airline, e.g. "TUIFly". */
  airline: string | null;
  /** Promo labels, e.g. "TUI Flashsale". */
  specials: string[];
  /** Discounts already deducted from the price, e.g. "40 € Cashback". */
  priceIncludes: string[];
  flightOutbound: FlightLeg | null;
  flightInbound: FlightLeg | null;
}

export interface Watch {
  id: string;
  name: string;
  url: string;
  mode: WatchMode;
  matchCriteria: MatchCriteria | null;
  /** Notify (once) when the price drops to or below this value. Null = off. */
  targetPrice: number | null;
  cron: string;
  active: boolean;
  createdAt: string; // ISO
}

export interface PricePoint {
  id: string;
  watchId: string;
  checkedAt: string; // ISO
  price: number | null;
  currency: string | null;
  /** The offer chosen for this data point (null on error / no availability). */
  offer: Offer | null;
  /** How many offers the scrape returned in total. */
  offersCount: number;
  /** Non-null if the check failed. */
  error: string | null;
  /** True if the price differs from the previous recorded point. */
  changed: boolean;
}

export const createWatchSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().refine((u) => u.includes("holidaycheck."), {
    message: "URL must be a holidaycheck.de package-offer link",
  }),
  mode: watchModeSchema.default("cheapest"),
  matchCriteria: matchCriteriaSchema.nullable().default(null),
  targetPrice: z.number().positive().nullable().default(null),
  cron: z.string().min(1).optional(),
  active: z.boolean().default(true),
});
export type CreateWatchInput = z.infer<typeof createWatchSchema>;

export const updateWatchSchema = createWatchSchema.partial();
export type UpdateWatchInput = z.infer<typeof updateWatchSchema>;
