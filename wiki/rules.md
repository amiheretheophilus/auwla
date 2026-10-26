# Ground rules

Stated by the user on 2026-10-18. They apply to every design and every fix.

> "the goal is to write normal javascript and get effecient compiled output"

1. **Normal JavaScript gets reactivity.** Users write ordinary `let`/`const`,
   functions and methods. The compiler derives reactivity from what values
   depend on, never from how the code is spelled. It adds no meaning of its own:
   JavaScript runs as written, and the compiler only decides what to re-run and
   when to update the UI. The user: "that is how javascrpt works we just have to
   let them replay in the browser ui".
2. **`let` vs `const` does not decide reactivity.** "this is not svelte".
   `const` is recommended for derived values because it is stricter; `let` works too.
3. **No method whitelists or blacklists for semantics.** Method lists exist only
   to optimize. An unlisted method must still work, never be rejected.
4. **Opaque fallback.** What the compiler cannot prove is handled conservatively
   (opaque), not rejected with an error.
5. **No try/catch/finally.** Never wrap generated or authored code in them.
   The user: "not acceptable".
6. **Keep list performance.** Lists sometimes beat Solid. Do not regress them;
   check `bench/` when touching list code.
7. **Do not edit failing test cases to make them pass.** Fix the compiler or
   report the failure.
8. **Readiness:** every resolved value (server function, `$fetch`, `$read`)
   is waited on by everything that depends on it while it is loading.
9. **Refs are reactive**, so users never need a ref plus an effect.
10. **Every JavaScript expression is accepted, and its effect shows on the UI**
    (2026-10-19). The user: "we accept every javascript expression and every
    expression that we can see it effect in the console means we need to see it
    on the ui". A compile error for valid JavaScript is a bug; a test that asserts
    such a rejection is deleted, with the user's agreement (first: `r14.test.ts`,
    reassigning a prop).
11. **Derived values and writes** (2026-10-19, agreed with the user):
    - `let` and `const` alike can be state or derived. The user: "const and let
      all are state and derived".
    - A binding follows its inputs until its first actual reassignment by
      later-running code (handler, effect or callback). That write takes control:
      it holds the assigned value and stops re-deriving. Merely creating or
      registering a callback does not freeze it. This uniformly replaces the
      earlier "snapshot from initialization" decision (2026-10-20).
      A `const` cannot be reassigned, so a `const` with a reactive initializer
      remains derived.
    - Effect executions own their locals (2026-10-26). A local created during
      an effect run keeps that run's value for its cleanup. The effect reruns
      when its inputs change. A cleanup reading an outer binding directly still
      reads its current value. See `compiler/effects.md`.
    - Writes in the component body (`let label = user.name; if (!label) label =
      'Anonymous';`) are part of the derivation and re-run with it. The user: "it
      should work since it somehow being part of a reactivity derivation".
    - Mutation is not reassignment. A derived object or array can be mutated
      (`const a = [...old]; a.push(x)`): the edit shows, and when the source
      changes the value is derived again. Details in `compiler/state-and-derived.md`.
    - A reassigned prop holds until the parent passes a different value.
12. **The UI updates when the console would show a change**: at the end of each
    synchronous stretch, including before every `await` (2026-10-19). The user:
    "it needs to follow how it will appear in the console".
13. **compiler-next beats the old compiler in correctness and in speed**
    (2026-10-19). The user: "we have to be better than the old compiler both
    correctness and performance". The `d6e678b` benchmark is the floor.
14. **The compiler wiki is the map of the code.** Each group of related files has
    a page in `compiler/`, changed in the same commit as the code.
15. **Readable source** (2026-10-26). The user: "your code is compressed why???
    i read it leave spaces and comments". Separate logical steps with blank
    lines, expand control flow, and use named helpers. Comments explain why a
    decision is needed, especially around readiness, ownership and ordering.
