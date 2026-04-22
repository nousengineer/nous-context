import React, { useEffect, useState } from 'react';
import apiClient from '../api/apiClient';

interface AgentStatus {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'success' | 'error';
  progress: number;
  phase: string;
}

const statusColors: Record<AgentStatus['status'], string> = {
  idle: '#ccc',
  running: '#3498db',
  success: '#27ae60',
  error: '#e74c3c',
};

const AgentStatusPanel: React.FC = () => {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/agents/status');
      setAgents(response.data);
    } catch (e) {
      setError('Falha ao carregar status dos agentes.');
      setAgents([]);
    }
    setLoading(false);
  };

  return (
    <section style={{padding: 16, background: '#f7f7f7', borderRadius: 8, margin: '16px 0'}}>
      <h3>Status dos Agentes</h3>
      {loading ? <p>Carregando...</p> : error ? <p style={{color: '#e74c3c'}}>{error}</p> : (
        <ul style={{listStyle: 'none', padding: 0}}>
          {agents.map(agent => (
            <li key={agent.id} style={{marginBottom: 12, display: 'flex', alignItems: 'center'}}>
              <span style={{width: 12, height: 12, borderRadius: '50%', background: statusColors[agent.status], display: 'inline-block', marginRight: 8}} />
              <strong style={{marginRight: 8}}>{agent.name}</strong>
              <span style={{marginRight: 8}}>{agent.phase}</span>
              <progress value={agent.progress} max={100} style={{marginRight: 8}} />
              <span>{agent.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default AgentStatusPanel;
