// Windowed grid renderer: only the cards in (and near) the viewport are in the DOM, so the
// directory can grow to thousands without DOM blowup. Requires fixed-height cells.
// See SPEC-DIRECTORY-001 non-functional budget and the plan's performance phase.

export interface VirtualGridOptions<T> {
  viewport: HTMLElement;
  rowHeight: number;
  minColumnWidth: number;
  gap: number;
  renderItem: (item: T, index: number) => HTMLElement;
  overscanRows?: number;
  inset?: number;
}

export class VirtualGrid<T> {
  private items: T[] = [];
  private readonly content: HTMLElement;
  private columns = 1;
  private cellWidth = 0;
  private readonly rendered = new Map<number, HTMLElement>();
  private readonly overscan: number;
  private readonly inset: number;
  private raf = 0;
  private readonly onScroll: () => void;
  private readonly onResize: () => void;

  constructor(private readonly opts: VirtualGridOptions<T>) {
    this.overscan = opts.overscanRows ?? 3;
    this.inset = opts.inset ?? 0;
    this.content = document.createElement('div');
    this.content.className = 'virtual-content';
    this.content.style.position = 'relative';
    this.content.style.width = '100%';
    opts.viewport.appendChild(this.content);

    this.onScroll = () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render(false);
      });
    };
    this.onResize = () => {
      this.measure();
      this.render(true);
    };

    opts.viewport.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
  }

  setItems(items: T[]): void {
    this.items = items || [];
    this.opts.viewport.scrollTop = 0;
    this.measure();
    this.render(true);
  }

  refresh(): void {
    this.render(true);
  }

  get count(): number {
    return this.items.length;
  }

  destroy(): void {
    this.opts.viewport.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    for (const node of this.rendered.values()) node.remove();
    this.rendered.clear();
    this.content.remove();
  }

  private measure(): void {
    const usable = Math.max(1, (this.opts.viewport.clientWidth || 1) - this.inset * 2);
    this.columns = Math.max(1, Math.floor((usable + this.opts.gap) / (this.opts.minColumnWidth + this.opts.gap)));
    this.cellWidth = Math.floor((usable - (this.columns - 1) * this.opts.gap) / this.columns);
    const rows = Math.ceil(this.items.length / this.columns);
    this.content.style.height = `${this.inset * 2 + rows * this.opts.rowHeight}px`;
  }

  private render(force: boolean): void {
    const viewport = this.opts.viewport;
    const scrollTop = viewport.scrollTop;
    const viewHeight = viewport.clientHeight || 1;

    const firstRow = Math.max(0, Math.floor(scrollTop / this.opts.rowHeight) - this.overscan);
    const lastRow = Math.floor((scrollTop + viewHeight) / this.opts.rowHeight) + this.overscan;
    const start = firstRow * this.columns;
    const end = Math.min(this.items.length, (lastRow + 1) * this.columns);

    if (force) {
      for (const node of this.rendered.values()) node.remove();
      this.rendered.clear();
    } else {
      for (const [index, node] of this.rendered) {
        if (index < start || index >= end) {
          node.remove();
          this.rendered.delete(index);
        }
      }
    }

    for (let index = start; index < end; index += 1) {
      if (this.rendered.has(index)) continue;
      const item = this.items[index];
      if (item === undefined) continue;
      const node = this.opts.renderItem(item, index);
      const row = Math.floor(index / this.columns);
      const col = index % this.columns;
      node.style.position = 'absolute';
      node.style.top = `${this.inset + row * this.opts.rowHeight}px`;
      node.style.left = `${this.inset + col * (this.cellWidth + this.opts.gap)}px`;
      node.style.width = `${this.cellWidth}px`;
      this.content.appendChild(node);
      this.rendered.set(index, node);
    }
  }
}
