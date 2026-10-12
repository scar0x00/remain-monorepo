import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChatBubble } from './chat-bubble';
import { ChatMessage } from '../../types/ChatMessage';

describe('ChatBubble', () => {
  let fixture: ComponentFixture<ChatBubble>;

  function render(message: ChatMessage) {
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatBubble],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatBubble);
  });

  it('renders the user text and attachment names', () => {
    render({
      id: 1,
      role: 'user',
      text: 'Focus on chapter 2',
      attachments: ['book.pdf', 'notes.tex'],
    });

    expect(text()).toContain('Focus on chapter 2');
    expect(text()).toContain('book.pdf');
    expect(text()).toContain('notes.tex');
  });

  it('omits the text paragraph when the user only attached files', () => {
    render({ id: 1, role: 'user', text: '', attachments: ['slides.png'] });

    expect(fixture.nativeElement.querySelector('p')).toBeNull();
    expect(text()).toContain('slides.png');
  });

  it('shows a spinner-style status while the agent is working', () => {
    render({ id: 2, role: 'assistant', state: 'pending', text: 'Generating 20 flashcards…' });

    expect(text()).toContain('Generating 20 flashcards…');
    expect(fixture.nativeElement.querySelector('.animate-spin')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
  });

  it('shows the error as an alert', () => {
    render({ id: 2, role: 'assistant', state: 'error', text: 'Deck biology.json already exists' });

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Deck biology.json already exists');
  });

  it('links to the study route when the deck was created', () => {
    render({
      id: 2,
      role: 'assistant',
      state: 'done',
      text: 'Created 5 flashcards in biology.',
      deckName: 'biology',
    });

    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toContain('Study deck');
    expect(link.getAttribute('href')).toBe('/deck-study/biology');
  });
});
