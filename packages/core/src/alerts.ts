import { loadConfig } from "./config.js";

export interface PushMessage {
  title: string;
  message: string;
  /** Supplementary URL shown in the notification. */
  url?: string;
  urlTitle?: string;
}

/**
 * Send a Pushover notification. Returns false (without throwing) when Pushover
 * is not configured, so recording price history never fails because of alerts.
 */
export async function sendPush(msg: PushMessage): Promise<boolean> {
  const { pushoverToken, pushoverUser, pushoverDevice } = loadConfig();
  if (!pushoverToken || !pushoverUser) return false;

  const body = new URLSearchParams({
    token: pushoverToken,
    user: pushoverUser,
    title: msg.title,
    message: msg.message,
  });
  if (pushoverDevice) body.set("device", pushoverDevice);
  if (msg.url) body.set("url", msg.url);
  if (msg.urlTitle) body.set("url_title", msg.urlTitle);

  try {
    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}
