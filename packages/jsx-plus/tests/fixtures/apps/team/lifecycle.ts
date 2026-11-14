/** What the pages' effects and cleanups did, in order. The preview logs it; tests read it. */
export const lifecycle: string[] = [];

$effect(()=> console.log(lifecycle))

export function note(event: string) {
  lifecycle.push(event);
}
