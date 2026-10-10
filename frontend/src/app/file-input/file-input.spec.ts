import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FileInput } from './file-input';

@Component({
  imports: [FileInput],
  template: `<app-file-input
    [multiple]="true"
    accept=".pdf,.md"
    (filesSelected)="selected = $event"
  />`,
})
class HostComponent {
  selected: File[] = [];
}

describe('FileInput', () => {
  let fixture: ComponentFixture<HostComponent>;
  let input: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
  });

  function choose(files: File[]) {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  it('passes accept and multiple to the native input', () => {
    expect(input.accept).toBe('.pdf,.md');
    expect(input.multiple).toBe(true);
  });

  it('emits the chosen files', () => {
    const a = new File(['a'], 'a.pdf');
    const b = new File(['b'], 'b.md');
    choose([a, b]);

    expect(fixture.componentInstance.selected).toEqual([a, b]);
  });

  it('clears the native input so the same file can be chosen again', () => {
    choose([new File(['a'], 'a.pdf')]);
    expect(input.value).toBe('');
  });

  it('does not emit when the selection is empty', () => {
    choose([]);
    expect(fixture.componentInstance.selected).toEqual([]);
  });

  it('opens the native file picker from the button', () => {
    const click = vi.spyOn(input, 'click');
    fixture.nativeElement.querySelector('button').click();
    expect(click).toHaveBeenCalled();
  });

  it('disables the button when disabled', async () => {
    const component = TestBed.createComponent(FileInput);
    component.componentRef.setInput('disabled', true);
    component.detectChanges();

    expect(component.nativeElement.querySelector('button').disabled).toBe(true);
  });
});
