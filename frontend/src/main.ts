import { bootstrapApplication } from "@angular/platform-browser";
import { appConfig } from "./app/app.config";
import { App } from "./app/app";

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

declare const Prism: any;

if (
  typeof window !== "undefined" && (window as any).Prism?.plugins?.autoloader
) {
  (window as any).Prism.plugins.autoloader.languages_path =
    "https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0/components/";
}
