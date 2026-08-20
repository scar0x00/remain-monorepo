import { ApplicationConfig, provideBrowserGlobalErrorListeners, SecurityContext } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideMarkdown, SANITIZE, KATEX_OPTIONS } from 'ngx-markdown';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(),
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