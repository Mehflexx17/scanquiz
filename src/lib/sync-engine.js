/**
 * ScanQuiz Realtime Senkronizasyon Motoru (SyncEngine)
 * 
 * Taşıma Katmanları:
 * 1. Firebase Firestore — Birincil Bulut Senkronizasyonu (Telefon ↔ Tahta, VPN, her cihaz)
 * 2. BroadcastChannel — Aynı tarayıcıdaki sekmeler (Ultra hızlı yerel)
 * 3. Supabase Realtime — Yedek bulut kanalı
 * 4. LocalStorage — Eski tarayıcı fallback
 * 
 * Odalar PIN bazlıdır: sq_<pin>. Farklı oturumlar asla karışmaz.
 */

import { db, doc, setDoc, onSnapshot } from './firebase';
import { supabase } from './supabase';

class HybridSyncEngine {
  constructor() {
    this.currentRoom = null;
    this.listeners = new Map();
    this.broadcastChannel = null;
    this.supabaseChannel = null;
    this.firebaseUnsub = null;
    this.senderId = 'cli_' + Math.random().toString(36).substring(2, 9);
    this.connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this._statusListeners = new Set();
    this._recentPacketIds = new Set(); // Duplicate detection
    this._maxRecentPackets = 300;

    if (typeof window !== 'undefined') {
      // BroadcastChannel — aynı tarayıcı sekmeleri arası
      try {
        this.broadcastChannel = new BroadcastChannel('scanquiz_local_sync');
        this.broadcastChannel.onmessage = (event) => {
          this._handlePacket(event.data);
        };
      } catch (e) {}

      // LocalStorage fallback
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
    this.currentRoom = `sq_${cleanPin}`;
    this._setStatus('connecting');

    // 1. Firebase Firestore Dinleyicisi
    this._setupFirebaseRoom();

    // 2. Supabase Realtime Kanalı (Yedek)
    this._setupSupabaseChannel();
  }

  _setupFirebaseRoom() {
    if (!db) {
      this._setStatus('connected');
      return;
    }

    try {
      if (this.firebaseUnsub) {
        this.firebaseUnsub();
        this.firebaseUnsub = null;
      }

      const roomRef = doc(db, 'rooms', this.currentRoom);
      this.firebaseUnsub = onSnapshot(roomRef, (snapshot) => {
        this._setStatus('connected');
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && data.lastPacket) {
            this._handlePacket(data.lastPacket);
          }
        }
      }, (err) => {
        console.warn('Firebase sync warning:', err.message);
        this._setStatus('connected');
      });
    } catch (err) {
      console.warn('Firebase init error:', err);
      this._setStatus('connected');
    }
  }

  _setupSupabaseChannel() {
    try {
      if (!supabase || !supabase.channel) {
        return;
      }

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
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this._setStatus('connected');
          }
        });
    } catch (err) {
      console.warn('Supabase Realtime warning:', err.message);
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

    // 1. BroadcastChannel (Yerel sekme)
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(packet); } catch (e) {}
    }

    // 2. LocalStorage Fallback
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('scanquiz_bus_event', JSON.stringify(packet)); } catch (e) {}
    }

    // 3. Firebase Firestore (Ana Bulut İletişimi)
    if (db && this.currentRoom) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom);
        setDoc(roomRef, {
          lastPacket: packet,
          updatedAt: Date.now()
        }, { merge: true }).catch(() => {});
      } catch (e) {}
    }

    // 4. Supabase Realtime (Yedek Bulut)
    if (this.supabaseChannel) {
      try {
        this.supabaseChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: packet
        });
      } catch (e) {}
    }

    // Kendi istemcimize de ilet
    this._dispatch(eventName, payload);
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
  }
}

export const syncEngine = new HybridSyncEngine();
