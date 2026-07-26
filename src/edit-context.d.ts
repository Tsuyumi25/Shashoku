// Hand-written because lib.dom.d.ts (TS 5.9) still has no EditContext. Only the
// members the cell editor touches are declared.

interface EditContextInit {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

interface TextUpdateEvent extends Event {
  readonly updateRangeStart: number;
  readonly updateRangeEnd: number;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly compositionStart: number;
  readonly compositionEnd: number;
}

interface TextFormat {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly underlineStyle: string;
  readonly underlineThickness: string;
}

interface TextFormatUpdateEvent extends Event {
  getTextFormats(): TextFormat[];
}

interface CharacterBoundsUpdateEvent extends Event {
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

interface EditContextEventMap {
  textupdate: TextUpdateEvent;
  textformatupdate: TextFormatUpdateEvent;
  characterboundsupdate: CharacterBoundsUpdateEvent;
  compositionstart: Event;
  compositionend: Event;
}

declare class EditContext extends EventTarget {
  constructor(init?: EditContextInit);
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly compositionRangeStart: number;
  readonly compositionRangeEnd: number;
  readonly characterBoundsRangeStart: number;
  characterBounds(): DOMRect[];
  attachedElements(): HTMLElement[];
  updateText(rangeStart: number, rangeEnd: number, text: string): void;
  updateSelection(start: number, end: number): void;
  updateControlBounds(controlBounds: DOMRect): void;
  updateSelectionBounds(selectionBounds: DOMRect): void;
  updateCharacterBounds(rangeStart: number, characterBounds: DOMRect[]): void;
  addEventListener<K extends keyof EditContextEventMap>(
    type: K,
    listener: (ev: EditContextEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

interface HTMLElement {
  editContext: EditContext | null;
}
