import { describe, expect, it } from 'vitest';
import { History } from '../src/history';

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History<number>();
    h.push({ label: 'a', before: 0, after: 1 });
    h.push({ label: 'b', before: 1, after: 2 });

    expect(h.canUndo).toBe(true);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeUndefined();

    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(2);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeUndefined();
  });

  it('clears the redo stack on a new push', () => {
    const h = new History<number>();
    h.push({ label: 'a', before: 0, after: 1 });
    h.undo();
    h.push({ label: 'b', before: 0, after: 5 });
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(0);
  });

  it('caps the undo stack at the limit', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 5; i++) h.push({ label: `s${i}`, before: i, after: i + 1 });
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBeUndefined();
  });
});
