import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ChatHistory } from '../chat-history/chat-history';
import { ChatSessionList } from './chat-session-list';

describe('ChatSessionList', () => {
  let fixture: ComponentFixture<ChatSessionList>;
  let drawerOpen: ReturnType<typeof signal<boolean>>;
  let rename: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let sessions: ReturnType<typeof signal<{ sessions: unknown[] } | undefined>>;
  let router: Router;

  const session = (id: string, title: string, deckName: string | null = null) => ({
    id,
    title,
    deckName,
    deckKey: deckName && `${deckName}.json`,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  });

  const host = () => fixture.nativeElement as HTMLElement;
  const click = (selector: string, index = 0) => {
    (host().querySelectorAll(selector)[index] as HTMLElement).click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    drawerOpen = signal(true);
    sessions = signal({
      sessions: [session('c1', 'Cells', 'biology'), session('c2', 'Atoms')],
    });
    rename = vi.fn().mockReturnValue(of({}));
    remove = vi.fn().mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [ChatSessionList],
      providers: [
        provideRouter([]),
        {
          provide: ChatHistory,
          useValue: {
            drawerOpen,
            rename,
            remove,
            sessions: {
              value: sessions,
              error: signal(undefined),
              isLoading: signal(false),
            },
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(ChatSessionList);
    fixture.detectChanges();
  });

  it('renders nothing while the drawer is closed', () => {
    drawerOpen.set(false);
    fixture.detectChanges();

    expect(host().querySelector('aside')).toBeNull();
  });

  it('lists the saved chats with links to reopen them and their deck names', () => {
    const links = [...host().querySelectorAll('li a')];

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/flashcard-chat/c1',
      '/flashcard-chat/c2',
    ]);
    expect(host().textContent).toContain('Cells');
    expect(host().textContent).toContain('biology');
  });

  it('shows an empty state', () => {
    sessions.set({ sessions: [] });
    fixture.detectChanges();

    expect(host().textContent).toContain('No saved chats yet');
  });

  it('closes when a chat is picked or the backdrop is clicked', () => {
    click('li a');
    expect(drawerOpen()).toBe(false);

    drawerOpen.set(true);
    fixture.detectChanges();
    click('button[aria-label="Close chat history"]');
    expect(drawerOpen()).toBe(false);
  });

  it('renames a chat', () => {
    click('button[aria-label="Rename Cells"]');
    const input = host().querySelector('input') as HTMLInputElement;
    input.value = '  Biology 101 ';
    (host().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(rename).toHaveBeenCalledWith('c1', 'Biology 101');
    expect(host().querySelector('input')).toBeNull();
  });

  it('does not rename to an empty or unchanged title', () => {
    click('button[aria-label="Rename Cells"]');
    (host().querySelector('input') as HTMLInputElement).value = '   ';
    (host().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    click('button[aria-label="Rename Cells"]');
    (host().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    expect(rename).not.toHaveBeenCalled();
  });

  it('asks before deleting a chat and then deletes only that chat', () => {
    click('button[aria-label="Delete Cells"]');
    expect(host().textContent).toContain('Delete chat? The deck stays.');
    expect(remove).not.toHaveBeenCalled();

    click('button.text-red-400');

    expect(remove).toHaveBeenCalledWith('c1');
  });

  it('can back out of a delete', () => {
    click('button[aria-label="Delete Cells"]');
    click('button:not(.text-red-400):not([aria-label])');

    expect(remove).not.toHaveBeenCalled();
    expect(host().textContent).not.toContain('Delete chat?');
  });

  it('leaves the conversation on screen when it was deleted', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/flashcard-chat/c1');

    click('button[aria-label="Delete Cells"]');
    click('button.text-red-400');

    expect(navigate).toHaveBeenCalledWith(['/flashcard-chat']);
  });

  it('stays on the page when another chat was deleted', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/flashcard-chat/c2');

    click('button[aria-label="Delete Cells"]');
    click('button.text-red-400');

    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows an error when deleting fails', () => {
    remove.mockReturnValue(throwError(() => new Error('nope')));

    click('button[aria-label="Delete Cells"]');
    click('button.text-red-400');

    expect(host().querySelector('[role="alert"]')?.textContent).toContain(
      'Could not delete the conversation',
    );
  });
});
