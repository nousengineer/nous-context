import React from 'react';
import { useMutation, gql } from '@apollo/client';
import DeleteButton from './DeleteButton';

const DELETE_DECISION = gql`
  mutation DeleteDecision($id: ID!) {
    deleteDecision(id: $id)
  }
`;

interface Decision {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

interface DecisionListProps {
  decisions: Decision[];
  onDelete?: () => void;
}

export default function DecisionList({ decisions, onDelete }: DecisionListProps) {
  const [deleteDecision] = useMutation(DELETE_DECISION, {
    refetchQueries: ['GetProjectDetail'],
  });

  const handleDelete = async (id: string) => {
    await deleteDecision({ variables: { id } });
    onDelete?.();
  };

  if (decisions.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 text-center">
        <p className="text-slate-400">No decisions recorded yet. Document your architectural decisions here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {decisions.map((decision) => (
        <div key={decision.id} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <h3 className="font-semibold text-white">{decision.title}</h3>
              <span className="inline-block mt-1 px-2 py-1 bg-blue-900 rounded text-xs">
                {decision.status}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs text-slate-300 opacity-75 whitespace-nowrap">
                {new Date(decision.createdAt).toLocaleDateString()}
              </span>
              <DeleteButton
                itemName={decision.title}
                onDelete={() => handleDelete(decision.id)}
                variant="small"
              />
            </div>
          </div>
          <p className="text-slate-100 mt-2">{decision.description}</p>
        </div>
      ))}
    </div>
  );
}