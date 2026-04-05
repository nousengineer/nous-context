

interface DeleteConfirmationDialogProps {
  title: string;
  message: string;
  itemName: string;
  isOpen: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmationDialog({
  title,
  message,
  itemName,
  isOpen,
  isLoading = false,
  onConfirm,
  onCancel,
}: DeleteConfirmationDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold text-red-400 mb-2">{title}</h2>
        <p className="text-slate-300 mb-4">{message}</p>
        <p className="text-slate-300 mb-6 bg-slate-700 p-3 rounded">
          <strong>Deleting:</strong> {itemName}
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-4 py-2 rounded transition font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded transition font-medium"
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
