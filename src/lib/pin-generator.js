/**
 * PIN Üretim & Oturum Yönetim Modülü
 *
 * - Kriptografik güvenli 6 haneli PIN üretir (crypto.getRandomValues)
 * - 20 saniyelik PIN rotasyonu
 * - Supabase üzerinden Realtime broadcast
 */

const PIN_LIFETIME_MS = 20_000; // 20 saniye

/**
 * Browser-safe kriptografik rastgele 6 haneli PIN üretir.
 * Math.random() kullanılmaz — tahmin edilebilir ve güvensizdir.
 */
export function generateSecurePin() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    // 100000 – 999999 aralığına sıkıştır
    const pin = 100000 + (array[0] % 900000);
    return pin.toString();
  }
  // Fallback (olmamalı ama safety net)
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * PIN yaşam döngüsü yöneticisi.
 * Öğretmen tarafında çalışır; PIN üretir, Supabase'e yazar,
 * realtime ile tahta istemcisine iletir.
 */
export class PinSessionManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.currentPin = null;
    this.sessionId = null;
    this.intervalId = null;
    this.onPinChange = null; // Callback: (pin, expiresAt) => void
  }

  /**
   * PIN rotasyonunu başlatır.
   * @param {string} teacherId - Öğretmenin auth.uid()
   * @param {function} onPinChange - Yeni PIN geldiğinde çağrılacak callback
   */
  async start(teacherId, onPinChange) {
    this.onPinChange = onPinChange;

    // İlk session'ı oluştur
    const { data: session, error } = await this.supabase
      .from('sessions')
      .insert({
        pin: generateSecurePin(),
        teacher_id: teacherId,
        status: 'active',
        expires_at: new Date(Date.now() + PIN_LIFETIME_MS).toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Session oluşturulamadı:', error);
      throw error;
    }

    this.sessionId = session.id;
    this.currentPin = session.pin;

    if (this.onPinChange) {
      this.onPinChange(session.pin, session.expires_at);
    }

    // 20 saniyede bir PIN'i yenile
    this.intervalId = setInterval(
      () => this._rotatePin(teacherId),
      PIN_LIFETIME_MS
    );

    return { sessionId: session.id, pin: session.pin };
  }

  async _rotatePin(teacherId) {
    const newPin = generateSecurePin();
    const expiresAt = new Date(Date.now() + PIN_LIFETIME_MS).toISOString();

    // Mevcut session'ın PIN'ini güncelle
    const { error } = await this.supabase
      .from('sessions')
      .update({
        pin: newPin,
        expires_at: expiresAt,
      })
      .eq('id', this.sessionId);

    if (error) {
      console.error('PIN rotasyonu başarısız:', error);
      return;
    }

    this.currentPin = newPin;

    if (this.onPinChange) {
      this.onPinChange(newPin, expiresAt);
    }
  }

  /**
   * PIN rotasyonunu durdurur ve session'ı kapatır.
   */
  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.sessionId) {
      await this.supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', this.sessionId);
    }
  }

  getCurrentPin() {
    return this.currentPin;
  }

  getSessionId() {
    return this.sessionId;
  }
}
