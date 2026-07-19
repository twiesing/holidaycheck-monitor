export type WatchMode = "cheapest" | "fixed";

export interface MatchCriteria {
  departureDate?: string;
  roomName?: string;
  mealType?: string;
  tourOperator?: string;
}

export interface FlightLeg {
  date: string;
  depTime: string;
  depAirport: string;
  arrTime: string;
  arrAirport: string;
  durationMin: number;
  stops: number;
  carrier: string | null;
}

export interface Offer {
  pricePerPerson: number;
  totalPrice: number;
  cashback: number;
  effectiveTotal: number;
  travellers: number;
  freeCancellationUntil: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  currency: string;
  departureDate: string;
  returnDate: string;
  nights: number;
  roomName: string;
  mealType: string;
  mealTypeName: string;
  tourOperator: string;
  bookingCode: string | null;
  attributes: string[];
  transferName: string | null;
  directFlight: boolean;
  departureAirport: string | null;
  departureAirportCode: string | null;
  airline: string | null;
  specials: string[];
  priceIncludes: string[];
  flightOutbound: FlightLeg | null;
  flightInbound: FlightLeg | null;
}

export interface PricePoint {
  id: string;
  watchId: string;
  checkedAt: string;
  price: number | null;
  currency: string | null;
  offer: Offer | null;
  offersCount: number;
  error: string | null;
  changed: boolean;
}

export interface Watch {
  id: string;
  name: string;
  url: string;
  mode: WatchMode;
  matchCriteria: MatchCriteria | null;
  targetPrice: number | null;
  cron: string;
  active: boolean;
  createdAt: string;
}

export interface WatchStats {
  min: number;
  max: number;
  avg: number;
  count: number;
  firstAt: string;
  isAllTimeLow: boolean;
}

export interface WatchWithLatest extends Watch {
  latest: PricePoint | null;
  previousPrice: number | null;
  stats: WatchStats | null;
}

export interface CreateWatchInput {
  name: string;
  url: string;
  mode: WatchMode;
  matchCriteria: MatchCriteria | null;
  targetPrice?: number | null;
  cron?: string;
  active?: boolean;
}
