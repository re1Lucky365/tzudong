// three 0.180.0 ships no declarations; covers only what Badge3DViewer imports.
declare module "three" {
  type Vector = {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): Vector;
  };

  export class CylinderGeometry {
    constructor(
      radiusTop?: number,
      radiusBottom?: number,
      height?: number,
      radialSegments?: number,
      heightSegments?: number,
      openEnded?: boolean,
    );
    dispose(): void;
  }

  export class MeshStandardMaterial {
    constructor(parameters?: {
      color?: number | string;
      flatShading?: boolean;
      metalness?: number;
      roughness?: number;
    });
    dispose(): void;
  }

  export class Object3D {
    readonly position: Vector;
    readonly rotation: Vector;
  }

  export class Mesh extends Object3D {
    constructor(geometry?: CylinderGeometry, material?: MeshStandardMaterial);
  }

  export class AmbientLight extends Object3D {
    constructor(color?: number | string, intensity?: number);
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number | string, intensity?: number);
  }

  export class Scene {
    add(...objects: Object3D[]): this;
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
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
    forceContextLoss(): void;
  }

  export {};
}
