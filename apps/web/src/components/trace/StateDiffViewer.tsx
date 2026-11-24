interface StateDiffViewerProps {
  entries: Array<{
    key: string;
    before?: string;
    after?: string;
    change_type: string;
  }>;
}

export function StateDiffViewer({ entries }: StateDiffViewerProps) {
  const getChangeColor = (changeType: string) => {
    switch (changeType.toLowerCase()) {
      case "created":
        return "bg-success/10 border-success/30";
      case "updated":
        return "bg-info/10 border-info/30";
      case "deleted":
        return "bg-destructive/10 border-destructive/30";
      default:
        return "bg-muted border-border";
    }
  };

  const getChangeBadge = (changeType: string) => {
    switch (changeType.toLowerCase()) {
      case "created":
        return (
          <span className="px-2 py-1 text-xs font-medium bg-success/15 text-success rounded">
            Created
          </span>
        );
      case "updated":
        return (
          <span className="px-2 py-1 text-xs font-medium bg-info/15 text-info rounded">
            Updated
          </span>
        );
      case "deleted":
        return (
          <span className="px-2 py-1 text-xs font-medium bg-destructive/15 text-destructive rounded">
            Deleted
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded">
            Unchanged
          </span>
        );
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card text-card-foreground shadow p-6">
      <h2 className="text-xl font-semibold mb-4">State Diff</h2>

      <div className="space-y-3">
        {entries.map((entry, idx) => (
          <div
            key={idx}
            className={`p-4 border rounded-lg ${getChangeColor(entry.change_type)}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-sm font-medium">{entry.key}</span>
              {getChangeBadge(entry.change_type)}
            </div>

            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Before</div>
                <pre className="text-xs bg-muted/30 text-card-foreground p-2 rounded border border-border overflow-x-auto">
                  {entry.before || "(none)"}
                </pre>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">After</div>
                <pre className="text-xs bg-muted/30 text-card-foreground p-2 rounded border border-border overflow-x-auto">
                  {entry.after || "(none)"}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>

      {entries.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          No state changes detected yet.
        </p>
      )}
    </div>
  );
}

export default StateDiffViewer;
