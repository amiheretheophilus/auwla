// The shapes the server's store keeps and its pages render. Types only: importing them brings no
// code into either build.

export interface Task {
  id: number;
  title: string;
  done: boolean;
}

export interface Project {
  id: string;
  name: string;
  /** `email` never reaches the browser: no page reads it. */
  owner: { name: string; email: string };
  /** Shown by the facts page, which ships no code, so it travels only as HTML. */
  budget: number;
  started: string;
  notes: string;
  tasks: Task[];
}

/** What the project list shows: names only. */
export interface ProjectSummary {
  id: string;
  name: string;
}
