// chat-realtime-client.js — Supabase Realtime subscription for chat messages
(function () {
  "use strict";

  const ChatRealtimeClient = {
    _client: null,
    _channel: null,
    _callback: null,
    _currentConvId: null,
    _polling: null,
    _lastMsgTime: null,

    // Init Supabase client. Falls back to polling if no credentials.
    async init() {
      const url = window.__SUPABASE_URL__;
      const key = window.__SUPABASE_ANON_KEY__;

      if (url && key) {
        try {
          const { createClient } = window.supabase;
          this._client = createClient(url, key);
          return;
        } catch (e) {
          console.warn("[ChatRealtime] Supabase init failed, falling back to polling:", e);
        }
      }

      // Try fetching from /api/config/public
      try {
        const res = await fetch("/api/config/public");
        if (res.ok) {
          const cfg = await res.json();
          const url2 = cfg.data?.supabaseUrl || cfg.supabaseUrl;
          const key2 = cfg.data?.supabaseAnonKey || cfg.supabaseAnonKey;
          if (url2 && key2) {
            const { createClient } = window.supabase;
            this._client = createClient(url2, key2);
            return;
          }
        }
      } catch (_) { /* silent — polling fallback below */ }

      console.info("[ChatRealtime] No Supabase credentials — using polling fallback");
    },

    // Set callback invoked on each new message: callback(messageRow)
    onMessage(callback) {
      this._callback = callback;
    },

    // Subscribe to INSERT events for a given conversationId
    subscribe(conversationId) {
      this.unsubscribe();
      this._currentConvId = conversationId;
      this._lastMsgTime = new Date().toISOString();

      if (this._client) {
        this._subscribeRealtime(conversationId);
      } else {
        this._startPolling(conversationId);
      }
    },

    _subscribeRealtime(conversationId) {
      this._channel = this._client
        .channel("chat-" + conversationId)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "Messages",
            filter: `ConversationID=eq.${conversationId}`,
          },
          (payload) => {
            if (this._callback && payload.new) {
              this._callback(payload.new);
            }
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.warn("[ChatRealtime] Channel error, switching to polling");
            this._channel = null;
            this._startPolling(conversationId);
          }
        });
    },

    _startPolling(conversationId) {
      if (this._polling) clearInterval(this._polling);
      this._polling = setInterval(() => this._pollMessages(conversationId), 5000);
    },

    async _pollMessages(conversationId) {
      const token = localStorage.getItem("auth_token");
      if (!token || this._currentConvId !== conversationId) return;
      try {
        const url = `/api/messages?conversationId=${conversationId}&limit=10`;
        const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) return;
        const json = await res.json();
        const msgs = json.data || [];
        msgs.forEach((m) => {
          if (m.NgayGui && m.NgayGui > this._lastMsgTime) {
            this._lastMsgTime = m.NgayGui;
            if (this._callback) this._callback(m);
          }
        });
      } catch (_) { /* ignore poll errors */ }
    },

    // Remove active subscription / polling
    unsubscribe() {
      if (this._channel) {
        try { this._client.removeChannel(this._channel); } catch (_) {}
        this._channel = null;
      }
      if (this._polling) {
        clearInterval(this._polling);
        this._polling = null;
      }
      this._currentConvId = null;
    },
  };

  window.ChatRealtimeClient = ChatRealtimeClient;
})();
