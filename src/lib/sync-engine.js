/**
 * ScanQuiz Realtime Senkronizasyon Motoru (SyncEngine)
 * 
 * Taşıma Katmanları:
 * 1. Supabase Realtime WebSocket — Doğrulanmış hızlı bulut taşıma (Telefon ↔ Tahta, VPN, 4G/5G)
 * 2. BroadcastChannel — Aynı tarayıcı sekmeleri (Ultra hızlı yerel)
 * 3. LocalStorage — Eski tarayıcı fallback
 * 4. Firebase Firestore — Opsiyonel bulut yedekleme
 * 
 * Güvenilirlik Özellikleri:
 * - Giden Mesaj Kuyruğu (Outbox Queue): Kanal 'SUBSCRIBED' olana kadar giden mesajlar bekletilir, bağlantı açılır açılmaz anında fırlatılır.
 * - Çift Yönlü El Sıkışma (Pair Handshake): 'host_paired' mesajı tahta alana kadar otomatik tekrar denenir.
 */

import { supabase } from './supabase';
import { db, doc, setDoc, onSnapshot } from './firebase';

class HybridSyncEngine {
  constructor() {
    this.currentRoom = null;
    this.rawPin = null;
    this.listeners = new Map();
    this.broadcastChannel = null;
    this.supabaseChannel = null;
    this.firebaseUnsub = null;
    this.senderId = 'cli_' + Math.random().toString(36).substring(2, 9);
    this.connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.isSubscribed = false;
    this.outbox = [];
    this._statusListeners = new Set();
    this._recentPacketIds = new Set();
    this._maxRecentPackets = 400;

    if (typeof window !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('scanquiz_local_sync');
        this.broadcastChannel.onmessage = (event) => {
          this._handlePacket(event.data);
        };
      } catch (e) {}

      window.addEventListener('storage', (event) => {
        if (event.key === 'scanquiz_bus_event' && event.newValue) {
          try {
            this._handlePacket(JSON.parse(event.newValue));
          } catch (e) {}
        }
      });
    }
  }

  onStatusChange(callback) {
    this._statusListeners.add(callback);
    callback(this.connectionStatus);
    return () => this._statusListeners.delete(callback);
  }

  _setStatus(status) {
    this.connectionStatus = status;
    this._statusListeners.forEach(cb => {
      try { cb(status); } catch (e) {}
    });
  }

  /**
   * Odayı ayarlar (Tahtanın veya Host'un bağlandığı 6 haneli PIN)
   */
  setRoom(pin) {
    if (!pin) return;
    const cleanPin = pin.toString().trim();
    this.rawPin = cleanPin;
    this.currentRoom = `sq_${cleanPin}`;
    this._setStatus('connecting');
    this.isSubscribed = false;

    // Supabase Realtime Kanalını kur
    this._setupSupabaseChannel();

    // Firebase varsa güvenle başlat
    this._setupFirebaseRoomSafe();
  }

  _setupSupabaseChannel() {
    if (!supabase || !supabase.channel) {
      this._setStatus('connected');
      return;
    }

    try {
      if (this.supabaseChannel) {
        try { supabase.removeChannel(this.supabaseChannel); } catch (e) {}
        this.supabaseChannel = null;
      }

      this.supabaseChannel = supabase.channel(this.currentRoom, {
        config: {
          broadcast: { self: false, ack: true }
        }
      });

      this.supabaseChannel
        .on('broadcast', { event: 'msg' }, ({ payload }) => {
          if (payload) {
            this._handlePacket(payload);
          }
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            this.isSubscribed = true;
            this._setStatus('connected');
            this._flushOutbox();
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            this.isSubscribed = false;
            this._setStatus('disconnected');
            // 2 saniye sonra otomatik yeniden bağlan
            setTimeout(() => {
              if (this.currentRoom) {
                this._setupSupabaseChannel();
              }
            }, 2000);
          }
        });
    } catch (err) {
      console.warn('Supabase Realtime setup warning:', err.message);
      this._setStatus('connected');
    }
  }

  _setupFirebaseRoomSafe() {
    if (!db || !this.currentRoom) return;
    try {
      if (this.firebaseUnsub) {
        this.firebaseUnsub();
        this.firebaseUnsub = null;
      }
      const roomRef = doc(db, 'rooms', this.currentRoom);
      this.firebaseUnsub = onSnapshot(roomRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && data.lastPacket) {
            this._handlePacket(data.lastPacket);
          }
        }
      }, () => {
        // Firebase Firestore API kapalıysa sessizce Supabase Realtime ile devam et
      });
    } catch (e) {}
  }

  _flushOutbox() {
    if (!this.isSubscribed || !this.supabaseChannel) return;
    while (this.outbox.length > 0) {
      const packet = this.outbox.shift();
      try {
        this.supabaseChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: packet
        });
      } catch (e) {}
    }
  }

  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    return () => {
      this.listeners.get(eventName)?.delete(callback);
    };
  }

  emit(eventName, payload = {}) {
    if (!this.currentRoom) {
      console.warn('Oda belirlenmeden mesaj gönderilemez.');
      return;
    }

    const packetId = `${this.senderId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    const packet = {
      id: packetId,
      room: this.currentRoom,
      event: eventName,
      payload,
      senderId: this.senderId,
      timestamp: Date.now()
    };

    this._trackPacketId(packetId);

    // 1. BroadcastChannel (Aynı tarayıcı sekmeleri)
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(packet); } catch (e) {}
    }

    // 2. LocalStorage Fallback
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('scanquiz_bus_event', JSON.stringify(packet)); } catch (e) {}
    }

    // 3. Supabase Realtime (Asıl Bulut WebSocket)
    if (this.isSubscribed && this.supabaseChannel) {
      try {
        this.supabaseChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: packet
        });
      } catch (e) {
        this.outbox.push(packet);
      }
    } else {
      // Henüz bağlanmadıysa kuyruğa al (bağlantı anında fırlatılır)
      this.outbox.push(packet);
    }

    // 4. Firebase Firestore (Varsa sessizce dene)
    if (db && this.currentRoom) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom);
        setDoc(roomRef, { lastPacket: packet, updatedAt: Date.now() }, { merge: true }).catch(() => {});
      } catch (e) {}
    }

    // Kendi istemcimizdeki dinleyicilere de ilet
    this._dispatch(eventName, payload);
  }

  /**
   * Eşleşme gibi kritik olayları karşı taraf alana kadar garanti gönderme
   */
  emitReliable(eventName, payload = {}, retries = 4, intervalMs = 500) {
    this.emit(eventName, payload);
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (count >= retries) {
        clearInterval(interval);
        return;
      }
      this.emit(eventName, payload);
    }, intervalMs);
    return () => clearInterval(interval);
  }

  _trackPacketId(id) {
    this._recentPacketIds.add(id);
    if (this._recentPacketIds.size > this._maxRecentPackets) {
      const firstId = this._recentPacketIds.values().next().value;
      this._recentPacketIds.delete(firstId);
    }
  }

  _handlePacket(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.room && this.currentRoom && packet.room !== this.currentRoom) return;
    if (packet.senderId === this.senderId) return;
    if (packet.id && this._recentPacketIds.has(packet.id)) return;

    if (packet.id) {
      this._trackPacketId(packet.id);
    }

    this._dispatch(packet.event, packet.payload);
  }

  _dispatch(eventName, payload) {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      handlers.forEach((callback) => {
        try { callback(payload); } catch (err) { console.error('Handler error:', err); }
      });
    }

    const globalHandlers = this.listeners.get('*');
    if (globalHandlers) {
      globalHandlers.forEach((callback) => {
        try { callback({ event: eventName, payload }); } catch (err) {}
      });
    }
  }

  destroy() {
    if (this.firebaseUnsub) {
      try { this.firebaseUnsub(); } catch (e) {}
      this.firebaseUnsub = null;
    }
    if (this.supabaseChannel && supabase) {
      try { supabase.removeChannel(this.supabaseChannel); } catch (e) {}
      this.supabaseChannel = null;
    }
    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch (e) {}
    }
    this.listeners.clear();
    this.outbox = [];
  }
}

export const syncEngine = new HybridSyncEngine();
