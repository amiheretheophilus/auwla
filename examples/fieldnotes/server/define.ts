import { createDefine } from '@memoized-dom/server';

export const define = createDefine<{
  requestId: string;
  visitor: string;
}>();
