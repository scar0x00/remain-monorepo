// The test DOM has no modal dialogs: just enough of HTMLDialogElement for components that open and
// close one, including the `close` event they listen to.
export function polyfillDialog() {
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  proto.close ??= function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}
