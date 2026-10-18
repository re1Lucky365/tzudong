// three 0.180.0 ships no declarations; covers only what Badge3DViewer imports.
declare module "three" {
  type Vector = { x: number; y: number; z: number };

  export class SphereGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
    dispose(): void;
  }

  export class MeshBasicMaterial {
    constructor(parameters?: { color?: number | string });
    dispose(): void;
  }

  export class Mesh {
    constructor(geometry?: SphereGeometry, material?: MeshBasicMaterial);
    readonly position: Vector;
    readonly rotation: Vector;
  }

  export class Scene {
    add(...objects: Mesh[]): this;
  }

  export class PerspectiveCamera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    readonly position: Vector;
  }

  export class WebGLRenderer {
    constructor(parameters?: {
      canvas?: HTMLCanvasElement;
      alpha?: boolean;
      antialias?: boolean;
    });
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    getContext(): WebGLRenderingContext | null;
    dispose(): void;
  }

  export {};
}
