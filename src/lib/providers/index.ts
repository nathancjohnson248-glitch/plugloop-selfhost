import { dodo } from "./dodo";
import { lemonsqueezy } from "./lemonsqueezy";
import { paddle } from "./paddle";
import { polar } from "./polar";
import { stripe } from "./stripe";
import type { ProviderId, WebhookAdapter } from "./types";

export const ADAPTERS: Record<ProviderId, WebhookAdapter> = { stripe, polar, lemonsqueezy, dodo, paddle };
export const PROVIDERS = Object.values(ADAPTERS);
export const isProvider = (v: string): v is ProviderId => Object.prototype.hasOwnProperty.call(ADAPTERS, v);
