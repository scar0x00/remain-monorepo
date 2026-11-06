import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { QuickSessionSetup } from './quick-session-setup';
import { QuickSessionOptions } from './quick-session';
import { Card } from '../../types/Card';

const cards = (n: number, tags: (i: number) => string[] = () => []): Card[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c_${i}`, front: `q${i}`, back: `a${i}`, meta: { tags: tags(i) } }));

describe('QuickSessionSetup', () => {
  let fixture: ComponentFixture<QuickSessionSetup>;
  let started: QuickSessionOptions[];
  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent!.replace(/\s+/g, ' ').trim().startsWith(text))!;

  async function setup(deck: Card[], initialTags: string[] = []) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(QuickSessionSetup);
    fixture.componentRef.setInput('title', 'Spanish');
    fixture.componentRef.setInput('cards', deck);
    fixture.componentRef.setInput('initialTags', initialTags);
    started = [];
    fixture.componentInstance.start.subscribe((o) => started.push(o));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const submit = async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  it('starts 10 cards by default and offers only presets smaller than the deck', async () => {
    await setup(cards(30));

    expect(button('20')).toBeDefined();
    expect(button('50')).toBeUndefined();
    expect(button('All 30')).toBeDefined();
    await submit();
    expect(started).toEqual([{ count: 10, tags: [] }]);
  });

  it('never asks for more cards than there are', async () => {
    await setup(cards(4));
    expect(button('Start')!.textContent).toContain('Start 4 cards');
  });

  it('takes a typed count', async () => {
    await setup(cards(30));
    const input = el().querySelector<HTMLInputElement>('#quick-count')!;
    input.value = '13';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    await submit();
    expect(started).toEqual([{ count: 13, tags: [] }]);
  });

  it('narrows the pool to the selected tags', async () => {
    await setup(cards(30, (i) => (i < 3 ? ['verbs'] : ['nouns'])));

    expect(button('nouns')).toBeDefined();
    button('verbs').click();
    await fixture.whenStable();

    expect(button('verbs').getAttribute('aria-pressed')).toBe('true');
    expect(button('All 3')).toBeDefined();
    await submit();
    expect(started).toEqual([{ count: 3, tags: ['verbs'] }]);
  });

  it('keeps the tags of the last run selected and drops ones the deck lost', async () => {
    await setup(cards(5, () => ['verbs']), ['verbs', 'gone']);
    await submit();
    expect(started).toEqual([{ count: 5, tags: ['verbs'] }]);
  });

  it('hides the tag picker when no card has tags', async () => {
    await setup(cards(5));
    expect(el().textContent).not.toContain('Only cards tagged');
  });
});
