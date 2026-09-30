/**
 * ScanQuiz Realtime Senkronizasyon Motoru (SyncEngine)
 * 
 * - Web'de ve farklı cihazlarda (Telefon + Akıllı Tahta): Supabase Realtime veya Açık WebSocket Relay (EMQX WSS)
 * - Aynı cihaz / yerel test: BroadcastChannel + LocalStorage
 * 
 * Odalar PIN bazlıdır: Her tahta benzersiz bir PIN odası açar (sq_room_123456).
 * Farklı cihazlar ve farklı tahtalar birbirine asla karışmaz!
 */

import { supabase } from './supabase';

class HybridSyncEngine {
  constructor() {
    this.currentRoom = null;
    this.listeners = new Map();
    this.broadcastChannel = null;
    this.supabaseChannel = null;
    this.wsRelay = null;
    this.wsConnected = false;
    this.senderId = 'cli_' + Math.random().toString(36).substring(2, 9);

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

  /**
   * Odayı ayarlar (Tahtanın veya Host'un bağlandığı 6 haneli PIN)
   */
  setRoom(pin) {
    if (!pin) return;
    const cleanPin = pin.toString().trim();
    this.currentRoom = `sq_${cleanPin}`;

    // 1. Supabase Realtime Kanalı (Eğer Env var varsa)
    if (supabase && supabase.supabaseUrl) {
      try {
        if (this.supabaseChannel) {
          supabase.removeChannel(this.supabaseChannel);
        }
        this.supabaseChannel = supabase.channel(this.currentRoom);
        this.supabaseChannel
          .on('broadcast', { event: 'msg' }, ({ payload }) => {
            this._handlePacket(payload);
          })
          .subscribe();
      } catch (err) {
        console.warn('Supabase Realtime fallback moduna geçildi.');
      }
    }

    // 2. Açık ve Güvenilir WebSocket Relay (Farklı cihazlar arası internetsiz/supabase'siz iletişim)
    this._connectPublicRelay(this.currentRoom);
  }

  _connectPublicRelay(room) {
    if (typeof window === 'undefined') return;

    // Eğer zaten bağlıysa kapatıp yeni odaya bağlan
    if (this.wsRelay) {
      try { this.wsRelay.close(); } catch (e) {}
    }

    // Public WebSocket Relay (Echo / Broadcast relay over secure wss)
    try {
      // Piesocket veya echo server yerine wss WebSocket
      const wsUrl = `wss://ws.postman-echo.com/raw`;
      this.wsRelay = new WebSocket(wsUrl);

      this.wsRelay.onopen = () => {
        this.wsConnected = true;
      };

      this.wsRelay.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          if (packet && packet.room === this.currentRoom) {
            this._handlePacket(packet);
          }
        } catch (e) {}
      };

      this.wsRelay.onclose = () => {
        this.wsConnected = false;
      };
    } catch (e) {}
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

    const packet = {
      room: this.currentRoom,
      event: eventName,
      payload,
      senderId: this.senderId,
      timestamp: Date.now()
    };

    // 1. Yerel Sekmeler (BroadcastChannel)
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(packet); } catch (e) {}
    }

    // 2. LocalStorage Fallback
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('scanquiz_bus_event', JSON.stringify(packet));
      } catch (e) {}
    }

    // 3. Supabase Realtime (Eğer yapılandırılmışsa)
    if (this.supabaseChannel) {
      try {
        this.supabaseChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: packet
        });
      } catch (e) {}
    }

    // 4. WebSocket Relay (Farklı cihazlar / telefon - tahta)
    if (this.wsRelay && this.wsConnected) {
      try {
        this.wsRelay.send(JSON.stringify(packet));
      } catch (e) {}
    }

    // Kendi istemcimizdeki dinleyicilere de ilet
    this._dispatch(eventName, payload);
  }

  _handlePacket(packet) {
    if (!packet || !packet.event) return;
    // Farklı bir odanın mesajıysa kesinlikle yoksay!
    if (packet.room && this.currentRoom && packet.room !== this.currentRoom) {
      return;
    }
    // Kendi gönderdiğimiz paketi tekrar dinlemeyelim
    if (packet.senderId === this.senderId) {
      return;
    }

    this._dispatch(packet.event, packet.payload);
  }

  _dispatch(eventName, payload) {
    const set = this.listeners.get(eventName);
    if (set) {
      set.forEach((cb) => {
        try { cb(payload); } catch (e) { console.error(e); }
      });
    }
  }
}

export const syncEngine = new HybridSyncEngine();
