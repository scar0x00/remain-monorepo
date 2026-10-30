import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { DeckEditor, cardErrors } from './deck-editor';
import { legacyCardId } from '../deck-format/deck-format';
import { Deck } from '../../types/Deck';

const DECK: Deck = {
  version: 2,
  meta: { title: 'Signals', tool: { kind: 'agent' } },
  cards: [
    { id: 'c_1', front: 'Q1', back: 'A1' },
    { id: 'c_2', front: 'Q2', back: 'A2', meta: { refs: [{ kind: 'page', label: '4' }] } },
    { id: 'c_3', front: 'Q3', back: 'A3' },
  ],
};

describe('DeckEditor', () => {
  let editor: DeckEditor;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DeckEditor, provideHttpClient(), provideHttpClientTesting()],
    });
    editor = TestBed.inject(DeckEditor);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function load(key = 'signals.json', body: string = JSON.stringify(DECK), etag = '"e1"') {
    const done = editor.load(key);
    http.expectOne(`/api/v1/deck/${key}`).flush(body, { headers: { etag } });
    await done;
  }

  const flushSave = (etag = '"e2"') => {
    const req = http.expectOne((r) => r.method === 'PUT');
    req.flush('ok', { headers: { etag } });
    return req;
  };

  it('loads a deck with its etag, unchanged', async () => {
    await load();

    expect(editor.status()).toBe('idle');
    expect(editor.draft()).toEqual(DECK);
    expect(editor.etag()).toBe('"e1"');
    expect(editor.dirty()).toBe(false);
    expect(editor.changeCount()).toBe(0);
  });

  it('loads a legacy deck with the ids study answers already use', async () => {
    await load('old.json', JSON.stringify([{ front: 'Q', back: 'A' }]));

    expect(editor.cards()[0].id).toBe(legacyCardId({ front: 'Q', back: 'A' }));
  });

  it('loads a YAML deck', async () => {
    await load('notes.yaml', 'version: 2\nmeta: {}\ncards:\n  - id: c_1\n    front: Q\n    back: A\n');

    expect(editor.cards()).toEqual([{ id: 'c_1', front: 'Q', back: 'A' }]);
  });

  it('reports a deck it cannot read', async () => {
    const done = editor.load('broken.json');
    http.expectOne('/api/v1/deck/broken.json').flush('{nope');
    await done;

    expect(editor.status()).toBe('load-failed');
  });

  it('tracks edits, additions, deletions and order', async () => {
    await load();

    editor.updateCard('c_1', { front: 'Q1 edited' });
    expect(editor.dirty()).toBe(true);
    expect([...editor.changedIds()]).toEqual(['c_1']);

    const added = editor.addCard('c_1');
    expect(editor.cards().map((c) => c.id)).toEqual(['c_1', added, 'c_2', 'c_3']);
    expect(added).toMatch(/^c_[0-9a-f]{12}$/);

    editor.removeCard('c_3');
    editor.moveCard('c_2', -1);
    expect(editor.cards().map((c) => c.id)).toEqual(['c_1', 'c_2', added]);
    // c_1 edited, the new card and c_3 deleted; c_2 only moved past the new card
    expect(editor.changeCount()).toBe(3);

    editor.moveCard('c_2', -1);
    expect(editor.cards().map((c) => c.id)).toEqual(['c_2', 'c_1', added]);
    expect(editor.changeCount()).toBe(4);

    editor.moveCard('c_1', -1);
    editor.updateCard('c_1', { front: 'Q1' });
    editor.removeCard(added);
    editor.restoreCard({ card: DECK.cards[2], index: 2 });
    expect(editor.dirty()).toBe(false);
  });

  it('duplicates a card with a new id and its metadata', async () => {
    await load();

    const copy = editor.duplicateCard('c_2')!;

    expect(editor.cards()[2]).toEqual({ ...DECK.cards[1], id: copy });
    expect(copy).not.toBe('c_2');
  });

  it('undoes a deletion at the same position', async () => {
    await load();

    const removed = editor.removeCard('c_2')!;
    editor.restoreCard(removed);

    expect(editor.draft()).toEqual(DECK);
  });

  it('keeps a card from being saved without a front, a back or a ref label', () => {
    expect(cardErrors({ id: 'c', front: ' ', back: '', meta: { refs: [{ kind: 'page', label: '' }] } })).toEqual({
      front: 'The front is empty',
      back: 'The back is empty',
      refs: 'Every reference needs a label of up to 100 characters',
    });
    expect(cardErrors({ id: 'c', front: 'Q', back: 'A' })).toEqual({});
  });

  it('does not save while a card has errors', async () => {
    await load();
    editor.addCard();

    expect(await editor.save()).toBe(false);
    expect(editor.status()).toBe('invalid');
  });

  it('saves the whole deck as JSON with If-Match and keeps the new etag', async () => {
    await load('notes.yaml', 'version: 2\nmeta: {}\ncards:\n  - id: c_1\n    front: Q\n    back: A\n');
    editor.updateCard('c_1', { back: 'A edited' });

    const saving = editor.save();
    const req = flushSave();

    expect(await saving).toBe(true);
    expect(req.request.url).toBe('/api/v1/deck/notes.yaml');
    expect(req.request.headers.get('if-match')).toBe('"e1"');
    expect(req.request.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(req.request.body)).toEqual({ version: 2, meta: {}, cards: [{ id: 'c_1', front: 'Q', back: 'A edited' }] });
    expect(editor.status()).toBe('saved');
    expect(editor.etag()).toBe('"e2"');
    expect(editor.dirty()).toBe(false);
  });

  it('stops on a 412 and can overwrite with the current etag', async () => {
    await load();
    editor.updateCard('c_1', { front: 'Mine' });

    const saving = editor.save();
    http.expectOne((r) => r.method === 'PUT').flush('changed', { status: 412, statusText: 'Precondition Failed' });
    expect(await saving).toBe(false);
    expect(editor.status()).toBe('conflict');
    expect(editor.dirty()).toBe(true);

    const overwriting = editor.overwrite();
    http.expectOne({ method: 'GET', url: '/api/v1/deck/signals.json' }).flush(JSON.stringify(DECK), { headers: { etag: '"theirs"' } });
    await Promise.resolve();
    await Promise.resolve();
    const req = flushSave('"e3"');

    expect(await overwriting).toBe(true);
    expect(req.request.headers.get('if-match')).toBe('"theirs"');
    expect(JSON.parse(req.request.body).cards[0].front).toBe('Mine');
  });

  it('drops the draft when reloading after a conflict', async () => {
    await load();
    editor.updateCard('c_1', { front: 'Mine' });

    const reloading = editor.reload();
    http.expectOne('/api/v1/deck/signals.json').flush(JSON.stringify({ ...DECK, cards: [DECK.cards[0]] }), { headers: { etag: '"theirs"' } });
    await reloading;

    expect(editor.cards()).toEqual([DECK.cards[0]]);
    expect(editor.dirty()).toBe(false);
    expect(editor.etag()).toBe('"theirs"');
  });

  it('reports a failed save other than a conflict', async () => {
    await load();
    editor.updateCard('c_1', { front: 'Mine' });

    const saving = editor.save();
    http.expectOne((r) => r.method === 'PUT').flush('boom', { status: 500, statusText: 'err' });

    expect(await saving).toBe(false);
    expect(editor.status()).toBe('save-failed');
  });
});
