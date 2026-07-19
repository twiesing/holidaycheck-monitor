import type {
  CreateWatchInput,
  PricePoint,
  Watch,
  WatchWithLatest,
} from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Only send a JSON content-type when there is actually a body — Fastify
  // rejects an empty body when content-type is application/json.
  const headers = init?.body ? { "content-type": "application/json" } : undefined;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = res.statusText;
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listWatches: () => req<WatchWithLatest[]>("/api/watches"),
  createWatch: (input: CreateWatchInput) =>
    req<Watch>("/api/watches", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateWatch: (id: string, patch: Partial<CreateWatchInput>) =>
    req<Watch>(`/api/watches/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteWatch: (id: string) =>
    req<void>(`/api/watches/${id}`, { method: "DELETE" }),
  history: (id: string) => req<PricePoint[]>(`/api/watches/${id}/history`),
  checkNow: (id: string) =>
    req<WatchWithLatest>(`/api/watches/${id}/check`, { method: "POST" }),
};
