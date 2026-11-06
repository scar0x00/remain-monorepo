import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NavBar } from './nav-bar';
import { Theme } from '../theme/theme';

describe('NavBar', () => {
  let fixture: ComponentFixture<NavBar>;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
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

  it('picks the theme from the menu', async () => {
    const radios = [...fixture.nativeElement.querySelectorAll('#nav-menu input[name="theme"]')] as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['system', 'light', 'dark']);
    expect(radios[0].checked).toBe(true);

    radios[1].click();
    await fixture.whenStable();
    expect(TestBed.inject(Theme).preference()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(radios[1].checked).toBe(true);
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });
});
