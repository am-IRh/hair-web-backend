import { env } from "../env.js";

export async function sendSms(to: string, message: string): Promise<void> {
  if (env.SMS_DRIVER === "console") {
    console.log(`[DEV SMS] → ${to}: ${message}`);
    return;
  }
  // TODO: Real SMS Panel
  throw new Error("SMS provider is not configured");
}
