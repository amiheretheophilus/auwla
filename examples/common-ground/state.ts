/**
 * The studio's shared state: ordinary module variables and the functions that change them. Every
 * page reads them directly; the compiler updates whatever shows them.
 *
 * Navigation is not state here: the URL is (`App.auwla`), so pages decide where to go after an
 * action (`launchCrew` reports whether it launched; the caller navigates).
 */
import { people, briefs, starterTasks, type Brief } from "./data";

/** The browser's saved session, when this browser has storage. */
const STORAGE_KEY = "common-ground-v2";
const storage = "localStorage" in globalThis ? globalThis.localStorage : undefined;

const isPerson = (id: string) => people.some((person) => person.id === id);
const isTask = (id: string) => starterTasks.some((task) => task.id === id);
const list = (text: string | null) => (text ?? "").split(",").filter((item) => item !== "");

/**
 * The session saved by an earlier visit, or the starter one. It is stored as URL search
 * parameters, which parse without throwing whatever the stored text is; anything unknown is
 * dropped, so an edited or stale entry cannot break the app.
 */
function restore() {
  const saved = new URLSearchParams(storage?.getItem(STORAGE_KEY) ?? "");
  const budget = Number(saved.get("budget"));
  const name = saved.get("name");
  const description = saved.get("description");
  const skills = list(saved.get("skills"));
  if (name === null || description === null || skills.length === 0 || !Number.isFinite(budget)) {
    return { crew: ["kwame"], saved: ["ama"], brief: briefs[0]!, launched: false, completed: [] as string[] };
  }
  return {
    crew: list(saved.get("crew")).filter(isPerson).slice(0, 4),
    saved: list(saved.get("saved")).filter(isPerson),
    brief: { name, description, skills, budget },
    launched: saved.get("launched") === "1",
    completed: list(saved.get("completed")).filter(isTask),
  };
}

const initial = restore();
export let crewIds: string[] = initial.crew;
export let savedIds: string[] = initial.saved;
export let brief: Brief = initial.brief;
export let launched = initial.launched;
export let completedIds: string[] = initial.completed;
/** A short message for the toast; empty when there is none. */
export let notice = "";

// Saved whenever any of these changes: the effect reads them all, so it runs again after each
// change, with no save call in the functions below.
$effect(() => {
  const session = new URLSearchParams({
    crew: crewIds.join(","),
    saved: savedIds.join(","),
    name: brief.name,
    description: brief.description,
    skills: brief.skills.join(","),
    budget: String(brief.budget),
    launched: launched ? "1" : "0",
    completed: completedIds.join(","),
  });
  storage?.setItem(STORAGE_KEY, session.toString());
});

export const MAX_CREW = 4;

export function toggleSaved(id: string) {
  savedIds = savedIds.includes(id) ? savedIds.filter((value) => value !== id) : [...savedIds, id];
}

export function addToCrew(id: string) {
  const person = people.find((value) => value.id === id);
  if (crewIds.includes(id)) {
    notice = "Already in your crew. Good taste!";
  } else if (crewIds.length >= MAX_CREW) {
    notice = "Keep it focused: your crew has room for four people.";
  } else if (person === undefined || !person.available) {
    notice = "This collaborator is booked right now. Save their profile for later.";
  } else {
    crewIds = [...crewIds, id];
    launched = false;
    notice = `${person.name.split(" ")[0]} joined your crew.`;
  }
}

export function removeFromCrew(id: string) {
  crewIds = crewIds.filter((value) => value !== id);
  launched = false;
}

export function useBrief(index: number) {
  brief = briefs[index]!;
  launched = false;
  completedIds = [];
  notice = "A fresh brief. Time to find the right people.";
}

/** The skills a direction asks for. */
const DIRECTION_SKILLS: Record<string, string[]> = {
  Community: ["Community", "Research", "Frontend"],
  Brand: ["Art direction", "Brand strategy", "Storytelling"],
  Product: ["Product design", "Frontend", "Brand strategy"],
};

export function createBrief(name: string, description: string, direction: string, budget: number) {
  brief = { name, description, skills: DIRECTION_SKILLS[direction] ?? DIRECTION_SKILLS.Product!, budget };
  launched = false;
  completedIds = [];
  notice = "Your new project is ready for a little good company.";
}

/** Launches the crew when it has at least two people; returns whether it did. */
export function launchCrew(): boolean {
  if (crewIds.length < 2) {
    notice = "Add at least two collaborators to start your project.";
    return false;
  }
  launched = true;
  notice = "Your project is live. Make something good together.";
  return true;
}

export function toggleTask(id: string) {
  completedIds = completedIds.includes(id)
    ? completedIds.filter((value) => value !== id)
    : [...completedIds, id];
}

export function clearNotice() {
  notice = "";
}

export function resetSession() {
  crewIds = ["kwame"];
  savedIds = ["ama"];
  brief = briefs[0]!;
  completedIds = [];
  launched = false;
  notice = "A fresh start. Your next good idea is waiting.";
}
