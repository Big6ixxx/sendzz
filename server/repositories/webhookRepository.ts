/**
 * Webhook Events Repository
 *
 * Database operations for storing and processing webhook events.
 */

import { createAdminClient } from '@/lib/supabase/server';
import type { Database, Json, WebhookProvider } from '@/types/database';

type WebhookEvent = Database['public']['Tables']['webhook_events']['Row'];

/**
 * Check if webhook event has been processed (idempotency check)
 */
export async function isEventProcessed(
  provider: WebhookProvider,
  eventId: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('webhook_events')
    .select('id, processed')
    .eq('provider', provider)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    console.error('[WebhookRepo] isEventProcessed error:', error);
    // On error, assume not processed to allow retry
    return false;
  }

  return data?.processed ?? false;
}

/**
 * Store webhook event
 */
export async function storeWebhookEvent(
  provider: WebhookProvider,
  eventId: string,
  payload: Json,
): Promise<WebhookEvent | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('webhook_events')
    .upsert(
      {
        provider,
        event_id: eventId,
        payload_json: payload,
        processed: false,
      },
      { onConflict: 'provider,event_id' },
    )
    .select()
    .single();

  if (error) {
    console.error('[WebhookRepo] store error:', error);
    return null;
  }
  return data;
}

/**
 * Mark webhook event as processed
 */
export async function markEventProcessed(
  provider: WebhookProvider,
  eventId: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('webhook_events')
    .update({ processed: true })
    .eq('provider', provider)
    .eq('event_id', eventId);

  if (error) {
    console.error('[WebhookRepo] markProcessed error:', error);
    return false;
  }
  return true;
}

/**
 * Get unprocessed webhook events (for retry/reprocessing)
 */
export async function getUnprocessedEvents(
  provider: WebhookProvider,
  limit: number = 100,
): Promise<WebhookEvent[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('provider', provider)
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[WebhookRepo] getUnprocessed error:', error);
    return [];
  }
  return data || [];
}
