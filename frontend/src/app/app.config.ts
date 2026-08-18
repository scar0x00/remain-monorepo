import { ApplicationConfig, provideBrowserGlobalErrorListeners, SecurityContext } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideMarkdown, SANITIZE } from 'ngx-markdown';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    provideMarkdown({
      sanitize: {
        provide: SANITIZE,
        useValue: SecurityContext.NONE,
      },
    }),
  ]
};