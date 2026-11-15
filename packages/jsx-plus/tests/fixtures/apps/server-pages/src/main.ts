import { mount } from '@memoized-dom/runtime';
import { App } from './App.auwla';

// With a server, the build makes this adopt the server's markup instead of rendering again.
export const application = mount('root', App);
