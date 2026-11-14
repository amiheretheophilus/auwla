export type Note = { id: number; title: string };

let nextId = 1;

export function createNote(title: string): Note {
  return { id: nextId++, title };
}
