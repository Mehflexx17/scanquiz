/**
 * ScanQuiz Realtime Senkronizasyon Motoru (SyncEngine)
 * 
 * Taşıma Katmanları:
 * 1. BroadcastChannel — Aynı tarayıcıdaki sekmeler (yerel test)
 * 2. Supabase Realtime — Farklı cihazlar (telefon ↔ tahta, VPN, farklı ülke)
 * 3. LocalStorage — Eski tarayıcı fallback
 * 
 * Odalar PIN bazlıdır: sq_<pin>. Farklı oturumlar asla karışmaz.
 */

import { supabase } from './supabase';

class HybridSyncEngine {
  constructor() {
    this.currentRoom = null;
    this.listeners = new Map();
    this.broadcastChannel = null;
    this.supabaseChannel = null;
    this.senderId = 'cli_' + Math.random().toString(36).substring(2, 9);
    this.connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this._statusListeners = new Set();
    this._recentPacketIds = new Set(); // Duplicate detection
    this._maxRecentPackets = 200;

    if (typeof window !== 'undefined') {
      // BroadcastChannel — aynı tarayıcı sekmeleri arası
      try {
        this.broadcastChannel = new BroadcastChannel('scanquiz_local_sync');
        this.broadcastChannel.onmessage = (event) => {
          this._handlePacket(event.data);
        };
      } catch (e) {
        // BroadcastChannel desteklenmiyor (eski tarayıcı)
      }

      // LocalStorage fallback — BroadcastChannel olmayan tarayıcılar
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
   * Bağlantı durumu dinleyicisi
   */
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

    // Supabase Realtime Kanalı — ASIL İLETİŞİM MOTORU
    // Farklı cihazlar, farklı ağlar, VPN — hepsi buradan haberleşir
    this._setupSupabaseChannel();
  }

  _setupSupabaseChannel() {
    try {
      // Supabase client'ın varlığını doğru şekilde kontrol et
      if (!supabase || !supabase.channel) {
        console.warn('Supabase client kullanılamıyor, yerel mod aktif.');
        this._setStatus('connected'); // Yerel modda çalış
        return;
      }

      // Önceki kanalı temizle
      if (this.supabaseChannel) {
        try {
          supabase.removeChannel(this.supabaseChannel);
        } catch (e) {}
        this.supabaseChannel = null;
      }

      this.supabaseChannel = supabase.channel(this.currentRoom, {
        config: {
          broadcast: {
            self: false, // Kendi mesajlarını almayı engelle (sunucu tarafında)
            ack: true    // Mesaj iletim onayı
          }
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
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            this._setStatus('disconnected');
            // Otomatik yeniden bağlanma (3 saniye sonra)
            setTimeout(() => {
              if (this.currentRoom) {
                this._setupSupabaseChannel();
              }
            }, 3000);
          }
        });
    } catch (err) {
      console.warn('Supabase Realtime bağlantı hatası:', err.message);
      this._setStatus('connected'); // Yerel modda çalışmaya devam et
    }
  }

  /**
   * Olay dinleyicisi ekler
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    return () => {
      this.listeners.get(eventName)?.delete(callback);
    };
  }

  /**
   * Olay yayınlar — tüm taşıma katmanlarına
   */
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

    // Kendi paketimizi kaydet (duplikasyon engeli)
    this._trackPacketId(packetId);

    // 1. BroadcastChannel — Aynı tarayıcı sekmeleri
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(packet); } catch (e) {}
    }

    // 2. LocalStorage Fallback
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('scanquiz_bus_event', JSON.stringify(packet));
      } catch (e) {}
    }

    // 3. Supabase Realtime — ANA İLETİŞİM (farklı cihazlar, farklı ağlar)
    if (this.supabaseChannel) {
      try {
        this.supabaseChannel.send({
          type: 'broadcast',
          event: 'msg',
          payload: packet
        });
      } catch (e) {
        console.warn('Supabase broadcast gönderilemedi:', e.message);
      }
    }

    // Kendi istemcimizdeki dinleyicilere de ilet
    this._dispatch(eventName, payload);
  }

  _trackPacketId(id) {
    this._recentPacketIds.add(id);
    // Set'in boyutunu sınırla
    if (this._recentPacketIds.size > this._maxRecentPackets) {
      const firstId = this._recentPacketIds.values().next().value;
      this._recentPacketIds.delete(firstId);
    }
  }

  _handlePacket(packet) {
    if (!packet || !packet.event) return;

    // Farklı bir odanın mesajıysa kesinlikle yoksay
    if (packet.room && this.currentRoom && packet.room !== this.currentRoom) {
      return;
    }

    // Kendi gönderdiğimiz paketi tekrar dinlemeyelim
    if (packet.senderId === this.senderId) {
      return;
    }

    // Duplikasyon kontrolü (aynı paket birden fazla taşıma katmanından gelebilir)
    if (packet.id) {
      if (this._recentPacketIds.has(packet.id)) {
        return; // Zaten işledik
      }
      this._trackPacketId(packet.id);
    }

    // Eski paketleri reddet (30 saniyeden eski)
    if (packet.timestamp && (Date.now() - packet.timestamp) > 30000) {
      return;
    }

    this._dispatch(packet.event, packet.payload);
  }

  _dispatch(eventName, payload) {
    const set = this.listeners.get(eventName);
    if (set) {
      set.forEach((cb) => {
        try { cb(payload); } catch (e) { console.error('Event handler error:', e); }
      });
    }
  }

  /**
   * Bağlantıyı temizler
   */
  destroy() {
    if (this.supabaseChannel) {
      try {
        supabase.removeChannel(this.supabaseChannel);
      } catch (e) {}
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch (e) {}
    }
    this.listeners.clear();
    this._statusListeners.clear();
    this._setStatus('disconnected');
  }
}

export const syncEngine = new HybridSyncEngine();
