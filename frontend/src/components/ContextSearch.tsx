import React, { useState, useMemo } from 'react';

interface ContextEntry {
  id: string;
  key: string;
  value: string;
  category: string;
  priority: number;
  createdAt: string;
}

interface ContextSearchProps {
  entries: ContextEntry[];
  onFilter: (filtered: ContextEntry[]) => void;
}

const CATEGORIES = ['architecture', 'requirements', 'dependencies', 'standards', 'general'];

export default function ContextSearch({ entries, onFilter }: ContextSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [minPriority, setMinPriority] = useState(1);

  const filtered = useMemo(() => {
    let result = entries;

    // Filter by search term
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (e) =>
          e.key.toLowerCase().includes(term) ||
          e.value.toLowerCase().includes(term) ||
          e.category.toLowerCase().includes(term)
      );
    }

    // Filter by categories
    if (selectedCategories.length > 0) {
      result = result.filter((e) => selectedCategories.includes(e.category));
    }

    // Filter by priority
    result = result.filter((e) => e.priority >= minPriority);

    return result.sort((a, b) => b.priority - a.priority);
  }, [entries, searchTerm, selectedCategories, minPriority]);

  React.useEffect(() => {
    onFilter(filtered);
  }, [filtered, onFilter]);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
        <input
          type="text"
          placeholder="Search by key, value, or category..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Categories {selectedCategories.length > 0 && `(${selectedCategories.length})`}
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              className={`px-3 py-1 rounded text-sm transition ${
                selectedCategories.includes(category)
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Minimum Priority: {minPriority}
        </label>
        <input
          type="range"
          min="1"
          max="4"
          value={minPriority}
          onChange={(e) => setMinPriority(parseInt(e.target.value))}
          className="w-full"
        />
        <div className="text-xs text-slate-400 mt-1">
          Showing entries with priority {minPriority} and above
        </div>
      </div>

      <div className="text-xs text-slate-400">
        {filtered.length} of {entries.length} entries
      </div>

      {selectedCategories.length > 0 && (
        <button
          onClick={() => setSelectedCategories([])}
          className="w-full bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm transition"
        >
          Clear Category Filters
        </button>
      )}
    </div>
  );
}
