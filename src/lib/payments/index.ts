import { env } from "../../env.js";
import { mockGateway } from "./mock.js";
import type { PaymentGateway } from "./types.js";

export function getGateway(): PaymentGateway {
  switch (env.PAYMENT_DRIVER) {
    case "mock":
      return mockGateway;
    case "zarinpal":
      throw new Error("Zarinpal driver is not implemented yet");
  }
}