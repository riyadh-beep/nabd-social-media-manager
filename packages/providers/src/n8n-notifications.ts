import type { AppEnvironment } from "../../config/src/env.js";

export type NotificationDelivery = { recipient: string; subject: string; html: string };

export async function deliverN8nNotification(environment: AppEnvironment, notification: NotificationDelivery): Promise<{ state: "delivered" | "disabled" }> {
  if (environment.email.status !== "configured" || !environment.email.notificationWebhookUrl || !environment.email.sharedSecret) return { state: "disabled" };
  const response = await fetch(environment.email.notificationWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: environment.email.sharedSecret },
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Notification adapter rejected the delivery request");
  const outcome = await response.json().catch(() => ({})) as { accepted?: boolean };
  if (!outcome.accepted) throw new Error("Notification adapter did not accept the delivery request");
  return { state: "delivered" };
}
