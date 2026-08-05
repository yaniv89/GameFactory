/** The subset of Pixi.Container (or a test fake) needed to add/remove a display child. */
export interface ContainerLike<T> {
  addChild(child: T): void;
  removeChild(child: T): void;
}
