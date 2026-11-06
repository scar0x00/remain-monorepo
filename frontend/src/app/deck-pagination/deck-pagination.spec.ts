import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { DeckPagination } from './deck-pagination';
import { DeckSearchTerm } from '../deck-search-term';
import { DeckPage } from '../../types/DeckEntry';

describe('DeckPagination', () => {
  let fixture: ComponentFixture<DeckPagination>;
  const current = signal<DeckPage | undefined>(undefined);

  const decks = (n: number) => Array.from({ length: n }, () => ({}) as never);
  const show = async (page: number, total: number, onPage: number) => {
    current.set({ decks: decks(onPage), total, page, pageSize: 10, sort: 'name', order: 'asc' });
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const el = () => fixture.nativeElement as HTMLElement;
  const link = (rel: string) => el().querySelector(`a[rel="${rel}"]`)?.getAttribute('href') ?? null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckPagination],
      providers: [
        provideRouter([]),
        {
          provide: DeckSearchTerm,
          useValue: {
            current,
            totalPages: () => Math.ceil(current()!.total / 10),
            pageParams: (page: number) => ({ page: page > 1 ? page : null }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DeckPagination);
  });

  it('is hidden when every deck fits on one page', async () => {
    await show(1, 10, 10);
    expect(el().querySelector('nav')).toBeNull();
  });

  it('links to the next page from the first', async () => {
    await show(1, 23, 10);
    expect(el().textContent).toContain('1–10 of 23 decks');
    expect(link('prev')).toBeNull();
    expect(link('next')).toBe('/?page=2');
  });

  it('links back from the last page, to the first without a page param', async () => {
    await show(3, 23, 3);
    expect(el().textContent).toContain('21–23 of 23 decks');
    expect(link('next')).toBeNull();

    await show(2, 23, 10);
    expect(link('prev')).toBe('/');
    expect(link('next')).toBe('/?page=3');
  });
});
