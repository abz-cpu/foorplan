-- Track the specific Stripe subscription alongside the customer, so webhook
-- updates/cancellations can be matched precisely instead of assuming an org
-- only ever has one subscription record in Stripe's own history.
alter table subscriptions add column stripe_subscription_id text;
