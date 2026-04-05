import { useState } from 'react';
import { useQuery, gql } from '@apollo/client';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';
import CreateProjectForm from './components/CreateProjectForm';

const GET_PROJECTS = gql`
  query GetProjects {
    projects {
      id
      name
      description
      status
      createdAt
      contextEntries {
        id
      }
      decisions {
        id
      }
    }
  }
`;

function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { data, loading, error } = useQuery(GET_PROJECTS);

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (error) return <div className="text-red-500 p-4">Error: {error.message}</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <header className="bg-slate-950 border-b border-slate-700 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">ThinkCoffee</h1>
          <p className="text-slate-400">Second brain for your AI development tools</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Projects Sidebar */}
          <aside className="lg:col-span-1">
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Projects</h2>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm transition"
                >
                  New
                </button>
              </div>

              {showCreateForm && (
                <CreateProjectForm
                  onCancel={() => setShowCreateForm(false)}
                  onSuccess={() => setShowCreateForm(false)}
                />
              )}

              <ProjectList
                projects={data?.projects || []}
                selectedId={selectedProjectId}
                onSelectProject={setSelectedProjectId}
              />
            </div>
          </aside>

          {/* Project Details */}
          <main className="lg:col-span-2">
            {selectedProjectId ? (
              <ProjectDetail projectId={selectedProjectId} />
            ) : (
              <div className="bg-slate-800 rounded-lg border border-slate-700 p-8 text-center">
                <p className="text-slate-400 mb-4">Select a project to get started</p>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded transition"
                >
                  Create First Project
                </button>
              </div>
            )}
          </main>
        </div>
      </main>
    </div>
  );
}

export default App;