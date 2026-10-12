import { Component, computed, inject, input } from "@angular/core";
import { StudyController } from "../study-controller/study-controller";

@Component({
  selector: "app-deck-study",
  imports: [StudyController],
  templateUrl: "./deck-study-route.html",
})
export class DeckStudyRoute {
  id = input.required<string>();

}
