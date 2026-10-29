import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownEditor } from './markdown-editor';

describe('MarkdownEditor', () => {
  let fixture: ComponentFixture<MarkdownEditor>;
  let textarea: HTMLTextAreaElement;
  let values: string[];

  beforeEach(async () => {
    fixture = TestBed.createComponent(MarkdownEditor);
    fixture.componentRef.setInput('label', 'Front');
    fixture.componentRef.setInput('fieldId', 'front-c_1');
    fixture.componentRef.setInput('value', 'x = 1');
    values = [];
    fixture.componentInstance.value.subscribe((v) => values.push(v));
    await fixture.whenStable();
    textarea = fixture.nativeElement.querySelector('textarea');
  });

  const key = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    textarea.dispatchEvent(event);
    return event;
  };

  it('shows the value under its label', () => {
    expect(textarea.value).toBe('x = 1');
    expect(fixture.nativeElement.querySelector('label').htmlFor).toBe('front-c_1');
  });

  it('indents with Tab instead of leaving the field', () => {
    textarea.setSelectionRange(0, 0);

    expect(key('Tab').defaultPrevented).toBe(true);
    expect(values.at(-1)).toBe('  x = 1');
  });

  it('lets Tab leave the field after Esc', () => {
    key('Escape');

    expect(key('Tab').defaultPrevented).toBe(false);
  });

  it('wraps the selection in inline or block math', () => {
    textarea.setSelectionRange(0, 5);
    fixture.componentInstance.inlineMath();
    expect(values.at(-1)).toBe('$x = 1$');

    textarea.setSelectionRange(0, textarea.value.length);
    fixture.componentInstance.blockMath();
    expect(values.at(-1)).toBe('\n$$\n$x = 1$\n$$\n');
  });

  it('marks the field invalid with its error', async () => {
    fixture.componentRef.setInput('error', 'The front is empty');
    await fixture.whenStable();

    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('The front is empty');
  });
});
