export type StartPaymentInput = {
  paymentId: string;
  amount: number;
  callbackUrl: string;
  description: string;
  mobile?: string;
};

export type VerifyResult =
  | { ok: true; refId: string; cardPan?: string }
  | { ok: false };

export interface PaymentGateway {
  name: "mock" | "zarinpal";
  start(input: StartPaymentInput): Promise<{ authority: string; redirectUrl: string }>;
  // Must THROW on network/gateway errors and return { ok: false } only on a definite rejection.
  verify(input: { authority: string; amount: number }): Promise<VerifyResult>;
}