import { ApplicationConfig, provideBrowserGlobalErrorListeners, SecurityContext } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideMarkdown, SANITIZE, KATEX_OPTIONS } from 'ngx-markdown';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    provideMarkdown({
      sanitize: {
        provide: SANITIZE,
        useValue: SecurityContext.NONE,
      },
      katexOptions: {
        provide: KATEX_OPTIONS,
        useValue: {
          nonStandard: true
        },
      }
    }),
  ]
};