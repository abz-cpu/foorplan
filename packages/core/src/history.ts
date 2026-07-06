/**
 * Undo/redo history for immutable documents.
 * Entries carry before/after snapshots (memento-style commands): applying an
 * entry means adopting `after`, undoing it means adopting `before`.
 */
export interface HistoryEntry<T> {
  label: string;
  before: T;
  after: T;
}

export class History<T> {
  private undoStack: HistoryEntry<T>[] = [];
  private redoStack: HistoryEntry<T>[] = [];

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Record a completed change. Clears the redo stack. */
  push(entry: HistoryEntry<T>): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the document state to adopt, or undefined when nothing to undo. */
  undo(): T | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    this.redoStack.push(entry);
    return entry.before;
  }

  /** Returns the document state to adopt, or undefined when nothing to redo. */
  redo(): T | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    this.undoStack.push(entry);
    return entry.after;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
