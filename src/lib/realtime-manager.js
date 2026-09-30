/**
 * Supabase Realtime Bağlantı Yöneticisi
 *
 * - Heartbeat mekanizması (30 saniyede bir)
 * - Exponential backoff ile yeniden bağlanma
 * - Çevrimdışı mesaj kuyruğu (localStorage cache)
 */

export class RealtimeManager {
  constructor(supabase, channelName) {
    this.supabase = supabase;
    this.channelName = channelName;
    this.channel = null;
    this.isConnected = false;
    this.pendingQueue = [];
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.handlers = {};
    this.onStatusChange = null;
  }

  /**
   * Kanala bağlan ve event handler'ları kaydet.
   * @param {Object} handlers - { eventName: (payload) => void }
   * @param {function} onStatusChange - (status) => void
   */
  connect(handlers, onStatusChange) {
    this.handlers = handlers;
    this.onStatusChange = onStatusChange;

    this.channel = this.supabase.channel(this.channelName);

    for (const [event, handler] of Object.entries(handlers)) {
      this.channel.on('broadcast', { event }, ({ payload }) => {
        handler(payload);
      });
    }

    this.channel.subscribe((status) => {
      switch (status) {
        case 'SUBSCRIBED':
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this._flushPendingQueue();
          this._startHeartbeat();
          if (this.onStatusChange) this.onStatusChange('connected');
          break;
        case 'CHANNEL_ERROR':
        case 'TIMED_OUT':
          this.isConnected = false;
          if (this.onStatusChange) this.onStatusChange('disconnected');
          this._attemptReconnect();
          break;
        case 'CLOSED':
          this.isConnected = false;
          this._stopHeartbeat();
          if (this.onStatusChange) this.onStatusChange('closed');
          break;
      }
    });

    return this.channel;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.channel && this.isConnected) {
        this.channel.send({
          type: 'broadcast',
          event: 'heartbeat',
          payload: { ts: Date.now() },
        }).catch(() => {
          this.isConnected = false;
          if (this.onStatusChange) this.onStatusChange('disconnected');
          this._attemptReconnect();
        });
      }
    }, 30_000);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Exponential backoff: 1s → 2s → 4s → ... → max 30s
   */
  async _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Maksimum yeniden bağlanma denemesi aşıldı');
      if (this.onStatusChange) this.onStatusChange('failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      30_000
    );

    console.log(
      `Yeniden bağlanma ${this.reconnectAttempts}/${this.maxReconnectAttempts} — ${delay}ms sonra`
    );

    await new Promise((r) => setTimeout(r, delay));

    if (this.channel) {
      this.supabase.removeChannel(this.channel);
    }

    this.connect(this.handlers, this.onStatusChange);
  }

  /**
   * Broadcast mesajı gönder.
   * Bağlantı yoksa kuyruğa ekler, bağlantı gelince gönderir.
   */
  async send(event, payload) {
    if (this.isConnected && this.channel) {
      try {
        await this.channel.send({
          type: 'broadcast',
          event,
          payload,
        });
      } catch {
        this.pendingQueue.push({ event, payload, ts: Date.now() });
        this._saveQueue();
      }
    } else {
      this.pendingQueue.push({ event, payload, ts: Date.now() });
      this._saveQueue();
    }
  }

  _saveQueue() {
    try {
      localStorage.setItem(
        `sq_queue_${this.channelName}`,
        JSON.stringify(this.pendingQueue.slice(-50))
      );
    } catch {
      // localStorage dolu, eski mesajları at
    }
  }

  _loadQueue() {
    try {
      const saved = localStorage.getItem(`sq_queue_${this.channelName}`);
      if (saved) this.pendingQueue = JSON.parse(saved);
    } catch {
      this.pendingQueue = [];
    }
  }

  async _flushPendingQueue() {
    this._loadQueue();
    const now = Date.now();
    const fiveMin = 5 * 60 * 1000;

    while (this.pendingQueue.length > 0) {
      const msg = this.pendingQueue.shift();
      if (now - msg.ts > fiveMin) continue;
      try {
        await this.channel.send({
          type: 'broadcast',
          event: msg.event,
          payload: msg.payload,
        });
      } catch {
        this.pendingQueue.unshift(msg);
        break;
      }
    }
    this._saveQueue();
  }

  disconnect() {
    this._stopHeartbeat();
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.isConnected = false;
  }
}
