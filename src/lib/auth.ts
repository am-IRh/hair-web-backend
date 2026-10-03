import { betterAuth } from "better-auth";
import { phoneNumber } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { sendSms } from "./sms.js";

const E164 = /^\+[1-9]\d{7,14}$/;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  trustedOrigins: [env.WEB_ORIGIN],
  plugins: [
    phoneNumber({
      phoneNumberValidator: (phone) => E164.test(phone),

      sendOTP: ({ phoneNumber, code }) => {
        void sendSms(phoneNumber, `کد ورود شما: ${code}`).catch((err) =>
          console.error("[sms] send failed:", err instanceof Error ? err.message : err),
        );
      },

      signUpOnVerification: {
        getTempEmail: (phone) => `${phone.replace("+", "")}@phone.invalid`,
      },
    }),
  ],
});