import { mount } from '@memoized-dom/runtime';
import { App } from './App.auwla';

// With a server, the build makes this adopt the server's markup instead of rendering again, and
// binds the server pages already in the document first.
export const application = mount('root', App);
