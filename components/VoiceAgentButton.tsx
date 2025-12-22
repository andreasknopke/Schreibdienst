"use client";
import { useMemo, useState } from 'react';
import { useElevenLabsConversation } from '@/lib/useElevenLabsConversation';

export default function VoiceAgentButton() {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_AGENT === '1';
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || '';
  const [connected, setConnected] = useState(false);
  const conv = useMemo(() => useElevenLabsConversation(), []);

  if (!enabled) return null;

  function toggle() {
    if (!connected) {
      conv.startConversation({
        agentId,
        dynamicVariables: {},
        onConnect: () => setConnected(true),
        onDisconnect: () => setConnected(false),
        onError: () => setConnected(false),
        onMessage: () => {},
      } as any);
    } else {
      conv.stopConversation();
      setConnected(false);
    }
  }

  return (
    <button className={`btn ${connected ? 'text-white' : 'btn-outline'}`} style={connected ? { background: '#dc2626' } : {}} onClick={toggle}>
      {connected ? 'Agent stoppen' : 'Agent starten'}
    </button>
  );
}
