import React, { useState } from 'react';
import DeleteConfirmationDialog from './DeleteConfirmationDialog';

interface DeleteButtonProps {
  itemName: string;
  onDelete: () => Promise<void>;
  variant?: 'danger' | 'small';
  className?: string;
}

export default function DeleteButton({
  itemName,
  onDelete,
  variant = 'danger',
  className = '',
}: DeleteButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onDelete();
      setIsOpen(false);
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const baseClasses = variant === 'small' 
    ? 'text-red-400 hover:text-red-300 text-sm'
    : 'bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm transition';

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`${baseClasses} ${className}`}
      >
        Delete
      </button>

      <DeleteConfirmationDialog
        title="Delete Confirmation"
        message={`Are you sure you want to delete this item? This action cannot be undone.`}
        itemName={itemName}
        isOpen={isOpen}
        isLoading={isLoading}
        onConfirm={handleConfirm}
        onCancel={() => setIsOpen(false)}
      />
    </>
  );
}
