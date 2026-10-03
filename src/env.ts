function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const paymentDriver = process.env.PAYMENT_DRIVER || "mock";
const APP_ENV = process.env.APP_ENV ?? "development"; // development | staging | production

if (paymentDriver !== "mock" && paymentDriver !== "zarinpal") {
  throw new Error(
    'PAYMENT_DRIVER must be "mock" or "zarinpal"',
  );
}

const isProd = APP_ENV === "production";

if (isProd && paymentDriver === "mock") {
  throw new Error("PAYMENT_DRIVER=mock is not allowed in production");
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  WEB_ORIGIN: required("WEB_ORIGIN"),
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  BETTER_AUTH_URL: required("BETTER_AUTH_URL"),
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  SMS_DRIVER: process.env.SMS_DRIVER === "console" ? "console" : "provider",
  PAYMENT_DRIVER: paymentDriver,
} as const;

if (isProd && env.SMS_DRIVER === "console") {
  throw new Error("SMS_DRIVER=console is not allowed in production");
}