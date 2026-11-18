import { define } from '../define';
import { loginAnalyst } from '../auth/routes';

export const login = define.function({
  async post({ request }, email: string, password: string) {
    return loginAnalyst(request, email, password);
  },
});
