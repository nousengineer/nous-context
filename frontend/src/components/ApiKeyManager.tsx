import React, { useState } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';

const GENERATE_API_KEY = gql`
  mutation GenerateApiKey($projectId: ID!, $name: String!) {
    generateApiKey(projectId: $projectId, name: $name) {
      id
      name
      key
      createdAt
    }
  }
`;

const GET_API_KEYS = gql`
  query GetApiKeys($projectId: ID!) {
    apiKeys(projectId: $projectId) {
      id
      name
      isActive
      lastUsed
      createdAt
    }
  }
`;

const REVOKE_API_KEY = gql`
  mutation RevokeApiKey($keyId: ID!) {
    revokeApiKey(keyId: $keyId)
  }
`;

interface ApiKey {
  id: string;
  name: string;
  isActive: boolean;
  lastUsed?: string;
  createdAt: string;
}

interface ApiKeyManagerProps {
  projectId: string;
}

export default function ApiKeyManager({ projectId }: ApiKeyManagerProps) {
  const [keyName, setKeyName] = useState('');
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, refetch } = useQuery(GET_API_KEYS, {
    variables: { projectId },
  });

  const [generateKey, { loading: genLoading }] = useMutation(GENERATE_API_KEY, {
    onCompleted: (data) => {
      setShowNewKey(data.generateApiKey.key);
      setKeyName('');
      refetch();
    },
  });

  const [revokeKey, { loading: revLoading }] = useMutation(REVOKE_API_KEY, {
    onCompleted: () => {
      refetch();
    },
  });

  const handleGenerate = () => {
    if (!keyName.trim()) return;
    generateKey({ variables: { projectId, name: keyName } });
  };

  const handleCopyKey = () => {
    if (showNewKey) {
      navigator.clipboard.writeText(showNewKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = (keyId: string) => {
    if (window.confirm('Are you sure? This API key will be permanently revoked.')) {
      revokeKey({ variables: { keyId } });
    }
  };

  const apiKeys: ApiKey[] = data?.apiKeys || [];

  return (
    <div className="space-y-6">
      {/* Generate New Key */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Generate New API Key</h3>
        
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Key name (e.g., 'GitHub Actions', 'Local Dev')"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleGenerate}
            disabled={genLoading || !keyName.trim()}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 px-6 py-2 rounded font-medium transition"
          >
            {genLoading ? 'Generating...' : 'Generate'}
          </button>
        </div>

        {/* Show New Key Once */}
        {showNewKey && (
          <div className="mt-4 p-4 bg-green-900 border border-green-700 rounded">
            <p className="text-sm text-green-300 mb-2">
              ✓ API Key generated! Copy it now - you won't see it again.
            </p>
            <div className="flex items-center gap-2 bg-slate-900 rounded p-2 mb-2">
              <code className="flex-1 text-xs text-slate-300 break-all font-mono">
                {showNewKey}
              </code>
              <button
                onClick={handleCopyKey}
                className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs whitespace-nowrap"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setShowNewKey(null)}
              className="text-sm text-slate-400 hover:text-slate-300"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Active Keys List */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Active API Keys</h3>

        {apiKeys.length === 0 ? (
          <p className="text-slate-400">No API keys yet. Generate one to get started.</p>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-3 bg-slate-700 rounded border border-slate-600"
              >
                <div className="flex-1">
                  <p className="font-medium text-white">{key.name}</p>
                  <div className="text-xs text-slate-400 mt-1 space-x-3">
                    <span>Created: {new Date(key.createdAt).toLocaleDateString()}</span>
                    {key.lastUsed && (
                      <span>Last used: {new Date(key.lastUsed).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(key.id)}
                  disabled={revLoading}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium transition ml-4"
                >
                  {revLoading ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage Example */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Usage Example</h3>
        <pre className="bg-slate-900 rounded p-3 text-xs text-slate-300 overflow-auto">
{`curl -X POST http://localhost:4000/graphql \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "query { projects { id name } }"
  }'`}
        </pre>
      </div>
    </div>
  );
}
