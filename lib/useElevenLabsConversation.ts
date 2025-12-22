"use client";
// Minimal, optional hook to connect to ElevenLabs ConvAI WebSocket
// Feature-flagged via NEXT_PUBLIC_ENABLE_AGENT

type Params = {
  agentId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (e: any) => void;
  onMessage?: (msg: any) => void;
  dynamicVariables?: Record<string, string>;
};

export function useElevenLabsConversation() {
  let ws: WebSocket | null = null;
  let status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  let isSpeaking = false;

  function start({ agentId, dynamicVariables, onConnect, onMessage, onError }: Params) {
    if (!agentId) throw new Error('agentId missing');
    const url = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
    ws = new WebSocket(url);
    status = 'connecting';

    ws.onopen = () => {
      status = 'connected';
      onConnect?.();
      const init = {
        type: 'conversation_initiation_client_data',
        conversation_initiation_client_data: {
          dynamic_variables: dynamicVariables ?? {},
        },
      };
      ws?.send(JSON.stringify(init));
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'ping') {
          ws?.send(JSON.stringify({ type: 'pong' }));
        }
        if (data.type === 'audio') {
          // audio handling could be added here
          isSpeaking = true;
        }
        onMessage?.(data);
      } catch {
        // ignore
      }
    };

    ws.onerror = (e) => {
      onError?.(e);
    };

    ws.onclose = () => {
      status = 'disconnected';
    };
  }

  function stop() {
    ws?.close();
    ws = null;
    status = 'disconnected';
  }

  return { startConversation: start, stopConversation: stop, get status() { return status; }, get isSpeaking() { return isSpeaking; } };
}
