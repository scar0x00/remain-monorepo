import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StudyController } from './study-controller';

describe('StudyController', () => {
  let component: StudyController;
  let fixture: ComponentFixture<StudyController>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudyController],
    }).compileComponents();

    fixture = TestBed.createComponent(StudyController);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
