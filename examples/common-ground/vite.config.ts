import { defineConfig } from "vite";
import memoizedDom from "@memoized-dom/vite";

// `.auwla` needs no option: compiler-next reads it. The app routes from `/`, so it is served from
// the root (a deep link such as `/people/ama` loads `index.html`, which then shows that page).
export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [memoizedDom({ clientEntry: "main.ts", compiler: "next" })],
});
