import { env } from "../../env";
import { mockGateway } from "./mock";
import type { PaymentGateway } from "./types";

export function getGateway(): PaymentGateway {
  switch (env.PAYMENT_DRIVER) {
    case "mock":
      return mockGateway;
    case "zarinpal":
      throw new Error("Zarinpal driver is not implemented yet");
  }
}