// Fällige-Task-Reminder (#30): Tasks mit Uhrzeit melden sich — konfigurierbar
// eine Vorlaufzeit VOR der Startzeit, mit oder ohne Ton — dazu eine tägliche
// 08:00-Übersicht. Tippen auf die Meldung öffnet die Aufgabe. Läuft nur nativ
// (Capacitor); im Browser werfen die Plugin-Aufrufe und werden still geschluckt.
import { LocalNotifications } from '@capacitor/local-notifications';
import { Ringtone } from './ringtone';
import type { Task } from './types';
import { isSameDay } from './selectors';

const SUMMARY_ID = 900001;
const CHANNEL_ID = 'rem_custom';

export interface ReminderPrefs {
  leadMin: number;
  sound: boolean;
  vibrate: boolean;
  soundUri: string | null; // device sound uri; null = default notification sound
}

// One native channel, (re)configured from the settings. Its sound/vibration
// are immutable once created, so the native plugin deletes + recreates it.
async function ensureChannels(p: { sound: boolean; vibrate: boolean; soundUri: string | null }): Promise<void> {
  try {
    await Ringtone.configureChannel({ uri: p.soundUri, vibrate: p.vibrate, sound: p.sound });
  } catch {
    /* Browser/Dev */
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const state = await LocalNotifications.checkPermissions();
    if (state.display === 'granted') return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch {
    return false;
  }
}

// Fire `callback(taskId)` when the user taps a reminder — used to deep-link into
// the task. Registered once; returns nothing (listener lives for the session).
export function onReminderTap(callback: (taskId: string) => void): void {
  try {
    LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const taskId = a.notification.extra?.taskId;
      if (taskId) callback(String(taskId));
    });
  } catch {
    /* Browser/Dev */
  }
}

export async function notificationStatus(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> {
  try {
    const s = await LocalNotifications.checkPermissions();
    return s.display as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'unavailable';
  }
}

export async function sendTestNotification(p: { sound: boolean; vibrate: boolean; soundUri: string | null }): Promise<string> {
  try {
    const ok = await ensureNotificationPermission();
    if (!ok) return 'Keine Erlaubnis — bitte Benachrichtigungen für SelfManaged erlauben.';
    await ensureChannels(p);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 999999,
          title: '🔔 Test-Benachrichtigung',
          body: 'Wenn du das siehst (und hörst), funktionieren Reminder.',
          channelId: CHANNEL_ID,
          schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
        },
      ],
    });
    return 'Test geplant — in ~5 Sekunden sollte die Benachrichtigung erscheinen.';
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : e}`;
  }
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Re-scheduled after every sync so the plan follows the current data + settings.
export async function scheduleReminders(tasks: Task[], prefs: ReminderPrefs): Promise<void> {
  try {
    const { leadMin, sound, vibrate, soundUri } = prefs;
    await ensureChannels({ sound, vibrate, soundUri });
    const channelId = CHANNEL_ID;

    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }

    const now = new Date();
    const dueToday = tasks.filter(
      (t) => !t.parentId && !t.completed && t.dueDate && isSameDay(t.dueDate, now)
    );

    const notifications = [];
    for (const t of dueToday) {
      if (t.startMinutes == null) continue;
      const eventAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, t.startMinutes);
      const fireAt = new Date(eventAt.getTime() - leadMin * 60_000);
      if (fireAt <= now) continue;
      notifications.push({
        id: t.number, // stabile, kleine Int-Id
        title: `⏰ ${t.title}`,
        body: leadMin > 0
          ? `In ${leadMin} Min fällig (um ${hhmm(t.startMinutes)})`
          : `Fällig um ${hhmm(t.startMinutes)}`,
        channelId,
        extra: { taskId: t.id }, // Tap → in die Aufgabe springen
        schedule: { at: fireAt, allowWhileIdle: true },
      });
    }

    // Bei genau 1 fälligem Task Namen zeigen + Tap-Deeplink (extra.taskId, via
    // onReminderTap) wie bei den Einzel-Remindern oben. Bei 0/>1 Tasks bleibt
    // der Zähltext ohne Deeplink, weil dort kein Task eindeutig zuordenbar ist.
    const single = dueToday.length === 1 ? dueToday[0] : null;
    notifications.push({
      id: SUMMARY_ID,
      title: single ? `📋 ${single.title}` : '📋 SelfManaged',
      body: single
        ? 'Heute fällig — antippen für Details'
        : dueToday.length
          ? `${dueToday.length} Aufgaben heute fällig`
          : 'Heute keine fälligen Aufgaben 🎉',
      channelId,
      ...(single ? { extra: { taskId: single.id } } : {}),
      schedule: { on: { hour: 8, minute: 0 }, allowWhileIdle: true },
    });

    await LocalNotifications.schedule({ notifications });
  } catch {
    /* Browser/Dev */
  }
}
