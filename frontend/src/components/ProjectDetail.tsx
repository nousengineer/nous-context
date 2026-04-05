import React, { useState } from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';
import ContextEntryList from './ContextEntryList';
import DecisionList from './DecisionList';
import CreateContextForm from './CreateContextForm';
import CreateDecisionForm from './CreateDecisionForm';
import ApiKeyManager from './ApiKeyManager';
import ContextExport from './ContextExport';
import DeleteButton from './DeleteButton';
import ContextSearch from './ContextSearch';

const DELETE_PROJECT = gql`
  mutation DeleteProject($id: ID!) {
    deleteProject(id: $id)
  }
`;

const GET_PROJECT_DETAIL = gql`
  query GetProjectDetail($id: ID!) {
    project(id: $id) {
      id
      name
      description
      status
      createdAt
      updatedAt
      contextEntries {
        id
        key
        value
        category
        priority
        createdAt
      }
      decisions {
        id
        title
        description
        status
        createdAt
      }
      apiKeys {
        id
        name
        isActive
        lastUsed
        createdAt
        revokedAt
      }
    }
  }
`;

interface ProjectDetailProps {
  projectId: string;
}

type Tab = 'context' | 'decisions' | 'api-keys' | 'export';

export default function ProjectDetail({ projectId }: ProjectDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('context');
  const [showContextForm, setShowContextForm] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [filteredContextEntries, setFilteredContextEntries] = useState<any[]>([]);
  const [deleteProject] = useMutation(DELETE_PROJECT, {
    refetchQueries: ['GetProjects'],
  });
  const { data, loading, error } = useQuery(GET_PROJECT_DETAIL, {
    variables: { id: projectId },
  });

  if (loading) return <div className="text-center py-8">Loading project...</div>;
  if (error) return <div className="text-red-400 p-4">Error: {error.message}</div>;

  const project = data?.project;
  if (!project) return <div className="text-slate-400 p-4">Project not found</div>;

  return (
    <div className="space-y-6">
      {/* Project Header */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-2">{project.name}</h2>
            {project.description && <p className="text-slate-300 mb-4">{project.description}</p>}
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <span>Status: {project.status}</span>
              <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <DeleteButton
            itemName={project.name}
            onDelete={() => deleteProject({ variables: { id: project.id } })}
            variant="danger"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('context')}
          className={`px-4 py-2 font-medium border-b-2 transition ${
            activeTab === 'context'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Context Entries ({project.contextEntries.length})
        </button>
        <button
          onClick={() => setActiveTab('decisions')}
          className={`px-4 py-2 font-medium border-b-2 transition ${
            activeTab === 'decisions'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Decisions ({project.decisions.length})
        </button>
        <button
          onClick={() => setActiveTab('api-keys')}
          className={`px-4 py-2 font-medium border-b-2 transition ${
            activeTab === 'api-keys'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          API Keys
        </button>
        <button
          onClick={() => setActiveTab('export')}
          className={`px-4 py-2 font-medium border-b-2 transition ${
            activeTab === 'export'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Export Context
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'context' && (
        <div className="space-y-4">
          <div>
            <button
              onClick={() => setShowContextForm(true)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition"
            >
              Add Context Entry
            </button>
          </div>

          {showContextForm && (
            <CreateContextForm
              projectId={projectId}
              onCancel={() => setShowContextForm(false)}
              onSuccess={() => setShowContextForm(false)}
            />
          )}

          <ContextSearch
            entries={project.contextEntries}
            onFilter={setFilteredContextEntries}
          />

          <ContextEntryList entries={filteredContextEntries.length > 0 ? filteredContextEntries : project.contextEntries} />
        </div>
      )}

      {activeTab === 'decisions' && (
        <div className="space-y-4">
          <div>
            <button
              onClick={() => setShowDecisionForm(true)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition"
            >
              Add Decision
            </button>
          </div>

          {showDecisionForm && (
            <CreateDecisionForm
              projectId={projectId}
              onCancel={() => setShowDecisionForm(false)}
              onSuccess={() => setShowDecisionForm(false)}
            />
          )}

          <DecisionList decisions={project.decisions} />
        </div>
      )}

      {activeTab === 'api-keys' && (
        <ApiKeyManager projectId={projectId} />
      )}

      {activeTab === 'export' && (
        <ContextExport 
          project={project}
          contextEntries={project.contextEntries}
          decisions={project.decisions}
        />
      )}
    </div>
  );
}