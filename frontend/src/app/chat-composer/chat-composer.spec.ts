import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatComposer } from './chat-composer';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';

function file(name: string, size = 100): File {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('ChatComposer', () => {
  let fixture: ComponentFixture<ChatComposer>;
  let component: ChatComposer;
  let submitted: GenerateDeckRequest[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatComposer],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComposer);
    component = fixture.componentInstance;
    submitted = [];
    component.submitted.subscribe((request) => submitted.push(request));
    fixture.detectChanges();
  });

  function el<T extends Element = HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }

  it('suggests a deck name from the first attached file', () => {
    component.addFiles([file('Intro to Biology.pdf')]);

    expect(component.deckName()).toBe('Intro-to-Biology');
  });

  it('keeps a deck name the user already typed', () => {
    component.deckName.set('my-deck');
    component.addFiles([file('notes.md')]);

    expect(component.deckName()).toBe('my-deck');
  });

  it('shows rejected files as problems and keeps the accepted ones', () => {
    component.addFiles([file('slides.pptx'), file('chapter.tex')]);

    expect(component.files().map((f) => f.name)).toEqual(['chapter.tex']);
    expect(component.problems()).toEqual(['slides.pptx: Unsupported file type']);
  });

  it('removes an attached file', () => {
    component.addFiles([file('a.md'), file('b.md', 200)]);
    component.removeFile(0);

    expect(component.files().map((f) => f.name)).toEqual(['b.md']);
  });

  it('emits a generate request built from the form state', () => {
    component.text.set('  Explain photosynthesis  ');
    component.deckName.set('plants');
    component.cardCount.set(12);
    component.overwrite.set(true);
    component.addFiles([file('plants.pdf')]);

    component.send();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual({
      deckName: 'plants',
      cardCount: 12,
      overwrite: true,
      refine: false,
      text: '  Explain photosynthesis  ',
      files: [expect.objectContaining({ name: 'plants.pdf' })],
    });
  });

  it('clears the message and files after sending but keeps the deck settings', () => {
    component.text.set('notes');
    component.deckName.set('plants');
    component.addFiles([file('plants.md')]);

    component.send();

    expect(component.text()).toBe('');
    expect(component.files()).toEqual([]);
    expect(component.deckName()).toBe('plants');
  });

  it('does not emit and shows the reason when the submission is invalid', () => {
    component.deckName.set('bad name');
    component.text.set('some text');

    component.send();

    expect(submitted).toEqual([]);
    expect(component.problems()).toEqual(["Deck name must be 1-100 letters, digits, '-' or '_'"]);
  });

  it('rejects a missing card count', () => {
    component.deckName.set('deck');
    component.text.set('some text');
    component.cardCount.set(null);

    component.send();

    expect(submitted).toEqual([]);
    expect(component.problems()[0]).toContain('Card count must be between 1 and 200');
  });

  it('does not send while disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    component.deckName.set('deck');
    component.text.set('some text');

    component.send();

    expect(submitted).toEqual([]);
  });

  it('sends when the form is submitted', () => {
    component.deckName.set('deck');
    component.text.set('some text');
    fixture.detectChanges();

    el<HTMLFormElement>('form').dispatchEvent(new Event('submit'));

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.text).toBe('some text');
  });

  describe('when a deck is active', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('activeDeck', 'plants');
      fixture.detectChanges();
    });

    it('emits a refinement of the active deck, ignoring the deck settings', () => {
      component.deckName.set('something-else');
      component.cardCount.set(null);
      component.text.set('Make the answers shorter');

      component.send();

      expect(submitted).toEqual([
        {
          deckName: 'plants',
          cardCount: 0,
          overwrite: false,
          refine: true,
          text: 'Make the answers shorter',
          files: [],
        },
      ]);
    });

    it('still requires an instruction or a file', () => {
      component.text.set('  ');

      component.send();

      expect(submitted).toEqual([]);
      expect(component.problems()).toEqual([
        'Describe the change to make, or attach files to add material from',
      ]);
    });

    it('hides the create-only fields and shows the deck being edited', () => {
      expect(el('input[name="deckName"]')).toBeNull();
      expect(el('input[name="cardCount"]')).toBeNull();
      expect(el('input[name="overwrite"]')).toBeNull();
      expect(el('form').textContent).toContain('Editing');
      expect(el('form').textContent).toContain('plants');
      expect(el('button[type="submit"]').textContent).toContain('Update deck');
    });
  });

  it('shows the create-only fields when no deck is active', () => {
    expect(el('input[name="deckName"]')).not.toBeNull();
    expect(el('input[name="cardCount"]')).not.toBeNull();
    expect(el('input[name="overwrite"]')).not.toBeNull();
    expect(el('button[type="submit"]').textContent).toContain('Generate');
  });

  it('resets the form to its defaults', () => {
    component.text.set('notes');
    component.deckName.set('plants');
    component.cardCount.set(3);
    component.overwrite.set(true);
    component.addFiles([file('plants.md'), file('bad.pptx')]);

    component.reset();

    expect(component.text()).toBe('');
    expect(component.deckName()).toBe('');
    expect(component.cardCount()).toBe(20);
    expect(component.overwrite()).toBe(false);
    expect(component.files()).toEqual([]);
    expect(component.problems()).toEqual([]);
  });

  it('renders a remove button for each attached file', () => {
    component.addFiles([file('a.md')]);
    fixture.detectChanges();

    expect(el('button[aria-label="Remove a.md"]')).not.toBeNull();
  });
});
