import { define } from './define';
import { createStore } from './store';

export const store = define.service('store', createStore);
