// Diktier-Mikrofonbutton (#101): native Spracherkennung fürs Quick-Add.
// Kein KI-Zwischenschritt — der erkannte Text landet 1:1 im Titelfeld, der
// Nutzer prüft/korrigiert und legt den Task über den bestehenden Flow an.
// Läuft nur nativ (Capacitor/Android); im Browser wirft das Plugin und wird
// hier zu einer klaren deutschen Fehlermeldung.
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export type VoiceResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function ensureMicrophonePermission(): Promise<boolean> {
  try {
    const state = await SpeechRecognition.checkPermissions();
    if (state.speechRecognition === 'granted') return true;
    const req = await SpeechRecognition.requestPermissions();
    return req.speechRecognition === 'granted';
  } catch {
    return false;
  }
}

// Startet eine einmalige Diktier-Session und liefert den besten Treffer.
export async function listenOnce(): Promise<VoiceResult> {
  try {
    const available = await SpeechRecognition.available();
    if (!available.available) {
      return { ok: false, error: 'Spracherkennung ist auf diesem Gerät nicht verfügbar.' };
    }
    const granted = await ensureMicrophonePermission();
    if (!granted) {
      return { ok: false, error: 'Mikrofonzugriff verweigert — bitte in den App-Einstellungen erlauben.' };
    }
    const result = await SpeechRecognition.start({
      language: 'de-DE',
      maxResults: 1,
      popup: false,
      partialResults: false,
    });
    const text = result.matches?.[0]?.trim();
    if (!text) {
      return { ok: false, error: 'Nichts verstanden — bitte erneut versuchen.' };
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Spracherkennung fehlgeschlagen.' };
  }
}
