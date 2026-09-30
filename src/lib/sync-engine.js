/**
 * ScanQuiz Hibrit Senkronizasyon Motoru (SyncEngine)
 * 
 * - Hem Supabase Realtime (Bulut)
 * - Hem BroadcastChannel + LocalStorage (Yerel / Offline / MEB Korumalı Ağlar)
 * 
 * Bu sayede internet olmasa bile tahta ve host aynı sekmede/cihazda
 * veya aynı ağda sıfır gecikmeyle gerçek zamanlı çalışır!
 */

import { supabase } from './supabase';

class HybridSyncEngine {
  constructor() {
    this.broadcastChannel = null;
    this.supabaseChannel = null;
    this.listeners = new Map();
    this.currentRoom = 'scanquiz_default';
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.useCloud = false;

    if (typeof window !== 'undefined') {
      // BroadcastChannel tarayıcı içi anlık iletişim için (0 latency)
      try {
        this.broadcastChannel = new BroadcastChannel('scanquiz_local_sync');
        this.broadcastChannel.onmessage = (event) => {
          this._handleIncomingMessage(event.data);
        };
      } catch (e) {
        console.warn('BroadcastChannel desteklenmiyor, localStorage fallback aktif.');
      }

      // LocalStorage event listener (farklı pencereler arası yedek)
      window.addEventListener('storage', (event) => {
        if (event.key === 'scanquiz_bus_event' && event.newValue) {
          try {
            const data = JSON.parse(event.newValue);
            this._handleIncomingMessage(data);
          } catch (err) {
            // ignore
          }
        }
      });

      window.addEventListener('online', () => { this.isOnline = true; });
      window.addEventListener('offline', () => { this.isOnline = false; });
    }
  }

  setRoom(roomPin) {
    this.currentRoom = `sq_room_${roomPin}`;
    if (this.supabase && supabase.supabaseUrl) {
      try {
        if (this.supabaseChannel) {
          supabase.removeChannel(this.supabaseChannel);
        }
        this.supabaseChannel = supabase.channel(this.currentRoom);
        this.supabaseChannel
          .on('broadcast', { event: 'sq_event' }, ({ payload }) => {
            this._handleIncomingMessage(payload, true);
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              this.useCloud = true;
            }
          });
      } catch (err) {
        console.warn('Supabase Realtime bağlantı kurulamadı, Yerel Mod aktif.');
        this.useCloud = false;
      }
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
    const packet = {
      event: eventName,
      payload,
      room: this.currentRoom,
      timestamp: Date.now(),
      senderId: this._getSenderId()
    };

    // 1. Yerel Yayın (BroadcastChannel)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packet);
      } catch (err) {
        console.error('BroadcastChannel gönderim hatası:', err);
      }
    }

    // 2. LocalStorage Fallback (Sekmeler arası)
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('scanquiz_bus_event', JSON.stringify(packet));
      } catch (e) {}
    }

    // 3. Bulut Yayın (Supabase Realtime)
    if (this.supabaseChannel && this.useCloud) {
      this.supabaseChannel.send({
        type: 'broadcast',
        event: 'sq_event',
        payload: packet
      }).catch((err) => {
        console.warn('Supabase gönderim hatası (yerel yayın çalışmaya devam ediyor):', err);
      });
    }

    // Yerel dinleyicileri de tetikle
    this._dispatch(eventName, payload);
  }

  _handleIncomingMessage(packet, fromCloud = false) {
    if (!packet || !packet.event) return;
    // Kendi gönderdiğimiz mesajları tekrar tetiklememek için
    if (packet.senderId === this._getSenderId() && !fromCloud) return;

    this._dispatch(packet.event, packet.payload);
  }

  _dispatch(eventName, payload) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(payload);
        } catch (e) {
          console.error(`Olay işleyici hatası [${eventName}]:`, e);
        }
      });
    }
  }

  _getSenderId() {
    if (typeof window === 'undefined') return 'server';
    if (!window.__sq_sender_id) {
      window.__sq_sender_id = 'sender_' + Math.random().toString(36).substring(2, 9);
    }
    return window.__sq_sender_id;
  }
}

export const syncEngine = new HybridSyncEngine();
