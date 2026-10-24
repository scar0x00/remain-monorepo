import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NavBar } from './nav-bar';

describe('NavBar', () => {
  let fixture: ComponentFixture<NavBar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavBar],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(NavBar);
    await fixture.whenStable();
  });

  it('links to the dashboard from the menu', () => {
    const menu = fixture.nativeElement.querySelector('#nav-menu') as HTMLElement;
    const links = [...menu.querySelectorAll('a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toContainEqual(['Dashboard', '/dashboard']);
    expect(fixture.nativeElement.querySelector('[popovertarget="nav-menu"]')).not.toBeNull();
  });
});
