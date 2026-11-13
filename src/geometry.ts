import * as THREE from 'three';

/**
 * A plain float copy of an attribute. Compressed models store positions,
 * normals and UVs as quantized integers; baking a transform into those (or
 * merging them with float geometry) needs real floats first.
 */
export function toFloatAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const { count, itemSize } = attribute;
  const array = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < itemSize; c += 1) array[i * itemSize + c] = attribute.getComponent(i, c);
  }
  return new THREE.BufferAttribute(array, itemSize);
}

/** A float copy of `source` (all attributes, index kept), ready to transform and merge. */
export function toFloatGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, toFloatAttribute(attribute));
  if (source.index) geometry.setIndex(Array.from(source.index.array));
  return geometry;
}
