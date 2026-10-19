# Ground rules

Stated by the user on 2026-10-18. They apply to every design and every fix.

> "the goal is to write normal javascript and get effecient compiled output"

1. **Normal JavaScript gets reactivity.** Users write ordinary `let`/`const`,
   functions and methods. The compiler derives reactivity from what values
   depend on, never from how the code is spelled.
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
    - A derived value is written `const`. A primitive one cannot be reassigned
      (JavaScript itself throws), so nothing is needed.
    - A derived object or array can be mutated (`const a = [...old]; a.push(x)`):
      the edit shows, and when the source changes the value is derived again.
    - A written `let` is state: its initializer is a snapshot taken once.
    - A reassigned prop holds until the parent passes a different value.
