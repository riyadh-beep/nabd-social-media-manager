import { getEnvironment, type AppEnvironment } from "../../config/src/env.js";

export function integrationStatus(environment: AppEnvironment) {
  return {
    openRouter: environment.openRouter.status,
    serpApi: environment.serpApi.status,
    openRouterImages: environment.openRouter.status,
    buffer: environment.buffer.status,
    unipile: environment.unipile.status,
    unipileWebhooks: environment.unipile.webhookSecret ? "configured" : "disabled",
    email: environment.email.status,
  } as const;
}

export function providerStatus() {
  return integrationStatus(getEnvironment());
}
