import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CardEditor } from './card-editor';
import { Card } from '../../types/Card';

describe('CardEditor', () => {
  let fixture: ComponentFixture<CardEditor>;
  let changes: Partial<Card>[];

  async function setup(card: Card, compact = false) {
    fixture = TestBed.createComponent(CardEditor);
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('compact', compact);
    changes = [];
    fixture.componentInstance.changed.subscribe((c) => changes.push(c));
    await fixture.whenStable();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('emits the edited side', async () => {
    await setup({ id: 'c_1', front: 'Q', back: 'A' });
    const back = el().querySelector<HTMLTextAreaElement>('#back-c_1')!;

    back.value = 'A2';
    back.dispatchEvent(new Event('input'));

    expect(changes).toEqual([{ back: 'A2' }]);
  });

  it('adds, edits and removes references, dropping empty meta', async () => {
    await setup({ id: 'c_1', front: 'Q', back: 'A', meta: { refs: [{ kind: 'page', label: '4', source: 'book' }] } });
    const editor = fixture.componentInstance;

    editor.addRef();
    expect(changes.at(-1)).toEqual({ meta: { refs: [{ kind: 'page', label: '4', source: 'book' }, { kind: 'page', label: '' }] } });

    editor.updateRef(0, { source: ' ' });
    expect(changes.at(-1)).toEqual({ meta: { refs: [{ kind: 'page', label: '4' }] } });

    editor.removeRef(0);
    expect(changes.at(-1)).toEqual({ meta: undefined });
  });

  it('adds a tag on Enter and ignores duplicates', async () => {
    await setup({ id: 'c_1', front: 'Q', back: 'A', meta: { tags: ['AM'] } });
    const input = el().querySelector<HTMLInputElement>('#tags-c_1')!;

    input.value = 'FM';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.value = 'AM';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(changes).toEqual([{ meta: { tags: ['AM', 'FM'] } }]);
  });

  it('only shows the two sides when compact', async () => {
    await setup({ id: 'c_1', front: 'Q', back: 'A' }, true);

    expect(el().querySelectorAll('textarea')).toHaveLength(2);
    expect(el().textContent).not.toContain('References');
  });
});
