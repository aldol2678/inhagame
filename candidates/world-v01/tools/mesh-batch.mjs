// Bake engine-neutral facade/road draw commands into static Three.js triangle batches.
import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
} from '../vendor/three.module.js';

const unitBox = new BoxGeometry(1, 1, 1);
const up = new Vector3(0, 1, 0);
const cylinders = new Map();
export class MeshBatch {
  vertices = [];
  triangle(color, a, b, c) {
    this.vertices.push([a, color], [b, color], [c, color]);
  }
  quad(color, a, b, c, d) {
    this.triangle(color, a, b, c);
    this.triangle(color, a, c, d);
  }
  primitive(color, geometry, center, rotation, scale) {
    const m = new Matrix4().compose(center, rotation, scale);
    const p = new Vector3();
    for (const index of geometry.index.array) {
      p.fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(m);
      this.vertices.push([p.toArray(), color]);
    }
  }
  box(color, center, size, yaw = 0) {
    this.primitive(
      color,
      unitBox,
      new Vector3(...center),
      new Quaternion().setFromEuler(new Euler(0, (yaw * Math.PI) / 180, 0)),
      new Vector3(...size),
    );
  }
  tube(color, a, b, radius, sides = 8) {
    const start = new Vector3(...a),
      delta = new Vector3(...b).sub(start);
    const length = delta.length();
    if (!length) return;
    if (!cylinders.has(sides)) cylinders.set(sides, new CylinderGeometry(1, 1, 1, sides));
    this.primitive(
      color,
      cylinders.get(sides),
      start.addScaledVector(delta, 0.5),
      new Quaternion().setFromUnitVectors(up, delta.normalize()),
      new Vector3(radius, length, radius),
    );
  }
  bytes() {
    // Three Float32 XYZ components + three sRGB bytes + one padding byte.
    const bytes = Buffer.alloc(this.vertices.length * 16);
    this.vertices.forEach(([point, color], i) => {
      point.forEach((v, k) => {
        if (!Number.isFinite(v)) throw new Error('Non-finite mesh vertex');
        bytes.writeFloatLE(v, i * 16 + k * 4);
      });
      const rgb = Number.parseInt(color.slice(1), 16);
      bytes.writeUIntBE(rgb, i * 16 + 12, 3);
    });
    return bytes;
  }
}
