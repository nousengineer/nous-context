
import { useMutation, gql } from '@apollo/client';
import DeleteButton from './DeleteButton';

const DELETE_PROJECT = gql`
  mutation DeleteProject($id: ID!) {
    deleteProject(id: $id)
  }
`;

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  contextEntries: Array<{ id: string }>;
  decisions: Array<{ id: string }>;
}

interface ProjectListProps {
  projects: Project[];
  selectedId: string | null;
  onSelectProject: (id: string) => void;
  onDeleteProject?: () => void;
}

export default function ProjectList({ projects, selectedId, onSelectProject, onDeleteProject }: ProjectListProps) {
  const [deleteProject] = useMutation(DELETE_PROJECT, {
    refetchQueries: ['GetProjects'],
  });

  const handleDelete = async (id: string) => {
    await deleteProject({ variables: { id } });
    onDeleteProject?.();
  };

  if (projects.length === 0) {
    return <p className="text-slate-400 text-sm py-4">No projects yet</p>;
  }

  return (
    <div className="space-y-2">
      {projects.map((project) => (
        <div
          key={project.id}
          className={`flex items-center rounded transition ${
            selectedId === project.id
              ? 'bg-blue-600'
              : 'bg-slate-700 hover:bg-slate-600'
          }`}
        >
          <button
            onClick={() => onSelectProject(project.id)}
            className="flex-1 text-left p-3"
          >
            <div className="font-medium text-slate-100">{project.name}</div>
            <div className="text-xs mt-1 opacity-75 text-slate-300">
              {project.contextEntries.length} context entries
              {' • '}
              {project.decisions.length} decisions
            </div>
          </button>
          <DeleteButton
            itemName={project.name}
            onDelete={() => handleDelete(project.id)}
            variant="small"
            className="mr-2"
          />
        </div>
      ))}
    </div>
  );
}