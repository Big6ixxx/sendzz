import { supabaseAdmin } from './adminClient';
import webpush from 'web-push';

const db = supabaseAdmin as any;

// Initialize web-push with VAPID credentials
if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:support@sendzz.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[Notifications] VAPID keys are missing from environment variables. Push notifications will be disabled.');
}

export interface NotificationPayload {
  id?: string;
  title: string;
  body: string;
  type: 'transfer' | 'bridge' | 'deposit' | 'withdrawal' | 'security';
  read?: boolean;
  data?: unknown;
  created_at?: string;
}

/**
 * Helper to fetch a user's UUID using their email address.
 */
async function getUserByEmail(email: string): Promise<string> {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error || !data) {
    throw new Error(`User not found for email: ${email}`);
  }
  return data.id;
}

/**
 * Saves a browser Web Push subscription for a user.
 */
export async function savePushSubscription(email: string, subscription: webpush.PushSubscription): Promise<void> {
  try {
    const userId = await getUserByEmail(email);
    
    // Check if subscription already exists for this user to avoid duplicates
    const { data: existing } = await db
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('subscription', JSON.stringify(subscription))
      .maybeSingle();

    if (!existing) {
      const { error } = await db
        .from('push_subscriptions')
        .insert({
          user_id: userId,
          subscription: subscription as any // Supabase JSONB type takes the parsed object directly
        });

      if (error) throw error;
      console.log(`[Notifications] Successfully registered push subscription for ${email}`);
    }
  } catch (err) {
    console.error('[Notifications] Failed to save push subscription:', err);
    throw err;
  }
}

/**
 * Fetches recent notifications for a user by email.
 */
export async function getNotifications(email: string, limit = 20): Promise<NotificationPayload[]> {
  try {
    const userId = await getUserByEmail(email);
    const { data, error } = await db
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data as NotificationPayload[]) || [];
  } catch (err) {
    console.error('[Notifications] Failed to fetch notifications:', err);
    return [];
  }
}

/**
 * Marks notifications as read.
 */
export async function markNotificationsAsRead(email: string, ids?: string[]): Promise<void> {
  try {
    const userId = await getUserByEmail(email);
    let query = db
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId);

    if (ids && ids.length > 0) {
      query = query.in('id', ids);
    } else {
      query = query.eq('read', false);
    }

    const { error } = await query;
    if (error) throw error;
    console.log(`[Notifications] Marked notifications as read for ${email}`);
  } catch (err) {
    console.error('[Notifications] Failed to mark notifications as read:', err);
  }
}

/**
 * Creates a notification record and pushes a web alert to active user devices.
 */
export async function createNotification(
  email: string,
  title: string,
  body: string,
  type: NotificationPayload['type'],
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const userId = await getUserByEmail(email);
    
    // 1. Insert into supabase DB for in-app history
    const { data: inserted, error } = await db
      .from('notifications')
      .insert({
        user_id: userId,
        title,
        body,
        type,
        data: data || null
      })
      .select()
      .single();

    if (error) throw error;
    console.log(`[Notifications] In-app notification created for ${email}: "${title}"`);

    // 2. Fetch all registered push subscriptions for this user
    const { data: subscriptions, error: subsError } = await db
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', userId);

    if (subsError || !subscriptions || subscriptions.length === 0) {
      console.log(`[Notifications] No push subscriptions found for ${email}. Skipping push.`);
      return;
    }

    // 3. Dispatch web push notifications concurrently to all registered devices
    const pushPayload = JSON.stringify({
      title,
      body,
      data: {
        url: data?.url || '/dashboard',
        notificationId: inserted.id
      }
    });

    console.log(`[Notifications] Sending push notifications to ${subscriptions.length} devices for ${email}...`);
    
    const pushPromises = subscriptions.map(async (subRow: { subscription: webpush.PushSubscription }) => {
      try {
        await webpush.sendNotification(subRow.subscription, pushPayload);
      } catch (pushErr) {
        const error = pushErr as { statusCode?: number; message?: string };
        console.warn('[Notifications] Failed to send push notification to device:', error.message);
        // If device subscription is expired or invalid (404/410), delete it from DB
        if (error.statusCode === 404 || error.statusCode === 410) {
          console.log('[Notifications] Deleting expired push subscription from DB.');
          await db
            .from('push_subscriptions')
            .delete()
            .eq('user_id', userId)
            .eq('subscription', JSON.stringify(subRow.subscription));
        }
      }
    });

    await Promise.all(pushPromises);
  } catch (err) {
    console.error('[Notifications] Failed to create or dispatch notification:', err);
  }
}
