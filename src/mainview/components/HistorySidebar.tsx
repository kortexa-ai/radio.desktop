import type { HistoryEntry } from "../../shared/types";

interface HistorySidebarProps {
    entries: HistoryEntry[];
    onSelect: (entry: HistoryEntry) => void;
    selectedId?: string;
}

export default function HistorySidebar({
    entries,
    onSelect,
    selectedId,
}: HistorySidebarProps) {
    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
            });
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return "Yesterday";
        }

        return date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
        });
    };

    return (
        <div className="w-56 flex-shrink-0 border-r border-purple-900/20 flex flex-col h-full">
            <div className="p-4 pb-3">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Recent Generations
                </h2>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {entries.length === 0 ? (
                    <div className="px-2 py-8 text-center">
                        <div className="text-2xl mb-2 opacity-50">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-slate-600">
                                <path d="M9 18V5l12-2v13" />
                                <circle cx="6" cy="18" r="3" />
                                <circle cx="18" cy="16" r="3" />
                            </svg>
                        </div>
                        <p className="text-xs text-slate-600">
                            No songs yet.
                            <br />
                            Generate your first track!
                        </p>
                    </div>
                ) : (
                    entries.map((entry) => (
                        <button
                            key={entry.id}
                            onClick={() => onSelect(entry)}
                            className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-all ${
                                selectedId === entry.id
                                    ? "bg-accent-purple/20 border border-accent-purple/30"
                                    : "hover:bg-surface-700/50 border border-transparent"
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                {entry.coverPath && (
                                    <img
                                        src={`file://${entry.coverPath}`}
                                        alt=""
                                        className="w-8 h-8 rounded flex-shrink-0 object-cover"
                                    />
                                )}
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-200 truncate">
                                        {entry.caption}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5">
                                        {formatTime(entry.timestamp)}
                                        {entry.duration > 0 && <> &middot; {entry.duration}s</>}
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
