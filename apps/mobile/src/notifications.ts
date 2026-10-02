// Fällige-Task-Reminder (#30): Tasks mit Uhrzeit melden sich — konfigurierbar
// eine Vorlaufzeit VOR der Startzeit, mit oder ohne Ton — dazu eine tägliche
// 08:00-Übersicht. Tippen auf die Meldung öffnet die Aufgabe. Läuft nur nativ
// (Capacitor); im Browser werfen die Plugin-Aufrufe und werden still geschluckt.
import { LocalNotifications } from '@capacitor/local-notifications';
import { Ringtone } from './ringtone';
import type { Task } from './types';
import { buildDailySummaries, buildTaskReminders } from './dailySummary';
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
    const notifications = [];
    // Zur Startzeit immer; mit Vorlaufzeit zusätzlich davor (#118).
    for (const r of buildTaskReminders(tasks, leadMin, now)) {
      notifications.push({
        id: r.id,
        title: r.title,
        body: r.body,
        channelId,
        extra: { taskId: r.taskId }, // Tap → in die Aufgabe springen
        schedule: { at: r.at, allowWhileIdle: true },
      });
    }

    // 08:00-Übersicht (#116): je Morgen eine eigene Meldung mit den Namen der
    // Aufgaben DIESES Tages (fällig oder ☀️), statt einer täglichen
    // Wiederholung mit dem Zähltext vom letzten Sync. 1 Task → Tap öffnet ihn;
    // mehrere → Tap öffnet die App (startet in Heute, #114).
    for (const s of buildDailySummaries(tasks, now)) {
      notifications.push({
        id: s.id,
        title: s.title,
        body: s.body,
        ...(s.largeBody ? { largeBody: s.largeBody } : {}),
        channelId,
        ...(s.taskId ? { extra: { taskId: s.taskId } } : {}),
        schedule: { at: s.at, allowWhileIdle: true },
      });
    }

    await LocalNotifications.schedule({ notifications });
  } catch {
    /* Browser/Dev */
  }
}
