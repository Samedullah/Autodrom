import * as THREE from 'three';
import type { GameSettings } from './save';

// Tunes the materials of an imported car once, when its model loads, so the
// car reads like a car under the sky environment: lacquered paint with a
// clear coat, mirror-like chrome, smooth reflective glass, matte rubber,
// metallic rims, lacquered carbon. The model's own textures and colours stay;
// only the surface response changes. Materials the model already gave a clear
// coat are left as authored.

type Kind = 'glass' | 'rubber' | 'rim' | 'chrome' | 'carbon' | 'paint';

const GLASS = /glass|window|windscreen|windshield|(^|[^a-z])lens/i;
const RUBBER = /tire|tyre|rubber/i;
const RIM = /(^|[^a-z])rims?([^a-z]|$)|wheel|alloy/i;
const CHROME = /chrome|chrm/i;
const CARBON = /carbon/i;
const PAINT = /car_?paint|coloured|colou?r|paint|(^|[^a-z])body/i;
const NOT_PAINT = /plast|interior|trim|black|glass|light|lamp|chrome|carbon|tire|tyre|(^|[^a-z])rims?([^a-z]|$)|wheel|brake|calip|callip|detail|disc|rotor|seat|engine|grill|grille|badge|logo|plate/i;

const PAINT_CLEARCOAT_ROUGHNESS = 0.03;
const CARBON_CLEARCOAT_ROUGHNESS = 0.06;

/** What the user's quality setting currently allows; applied to newly loaded models too. */
let currentQuality: GameSettings['quality'] = 'high';

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function luminance(material: THREE.Material): number {
  const color = (material as THREE.MeshStandardMaterial).color;
  return color ? 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b : 0;
}

function toPhysical(material: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  if ((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return material as THREE.MeshPhysicalMaterial;
  const physical = new THREE.MeshPhysicalMaterial();
  // Copy only the standard properties; the physical ones keep their defaults.
  THREE.MeshStandardMaterial.prototype.copy.call(physical, material);
  // MeshStandardMaterial.copy resets the shader defines to the standard set.
  (physical as unknown as { defines: Record<string, string> }).defines = { STANDARD: '', PHYSICAL: '' };
  return physical;
}

function classify(label: string, material: THREE.Material): Kind | null {
  if (GLASS.test(label)) return 'glass';
  if (RUBBER.test(label)) return 'rubber';
  if (CHROME.test(label)) return 'chrome';
  if (CARBON.test(label)) return 'carbon';
  // A dark "wheel" material is the tyre side of the wheel, not the rim.
  if (RIM.test(label)) return luminance(material) > 0.06 ? 'rim' : 'rubber';
  if (PAINT.test(label) && !NOT_PAINT.test(label)) return 'paint';
  return null;
}

/**
 * Refines a freshly loaded car model in place (before it is cached and
 * cloned). Returns the clear-coated materials so their varnish can follow the
 * quality setting.
 */
export function refineVehicleMaterials(model: THREE.Object3D, carLength: number): THREE.MeshPhysicalMaterial[] {
  const meshes: THREE.Mesh[] = [];
  model.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
  const kinds = new Map<THREE.Material, Kind>();
  const authoredClearcoat = new Set<THREE.Material>();
  for (const mesh of meshes) {
    let label = mesh.name;
    for (let parent = mesh.parent; parent && parent !== model; parent = parent.parent) label += ' ' + parent.name;
    for (const material of materialsOf(mesh)) {
      if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      if (((material as THREE.MeshPhysicalMaterial).clearcoat ?? 0) > 0) authoredClearcoat.add(material);
      if (kinds.has(material)) continue;
      const kind = classify(material.name + ' ' + label, material);
      if (kind) kinds.set(material, kind);
    }
  }

  // No paint by name: the paint is the material covering the most of the
  // car's outer shell (spanning most of its length).
  const hasPaint = [...kinds.values()].includes('paint') || authoredClearcoat.size > 0;
  if (!hasPaint) {
    const area = new Map<THREE.Material, number>();
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    model.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const materials = materialsOf(mesh);
      if (materials.length !== 1 || kinds.has(materials[0]) || materials[0].transparent) continue;
      box.setFromObject(mesh).getSize(size);
      if (size.z < carLength * 0.6) continue;
      area.set(materials[0], (area.get(materials[0]) ?? 0) + size.x * size.z + size.y * size.z);
    }
    const largest = [...area.entries()].sort((a, b) => b[1] - a[1])[0];
    if (largest) kinds.set(largest[0], 'paint');
  }

  const replaced = new Map<THREE.Material, THREE.Material>();
  const varnished: THREE.MeshPhysicalMaterial[] = [];
  for (const [material, kind] of kinds) {
    const standard = material as THREE.MeshStandardMaterial;
    if (kind === 'glass') {
      standard.roughness = Math.min(standard.roughness, 0.05);
      standard.metalness = 0;
      standard.envMapIntensity = 1.3;
    } else if (kind === 'rubber') {
      standard.roughness = Math.max(standard.roughness, 0.85);
      standard.metalness = 0;
      standard.envMapIntensity = 0.5;
    } else if (kind === 'rim') {
      standard.metalness = Math.max(standard.metalness, 0.75);
      standard.roughness = Math.min(standard.roughness, 0.35);
    } else if (kind === 'chrome') {
      standard.metalness = 1;
      standard.roughness = Math.min(standard.roughness, 0.1);
    } else if (!authoredClearcoat.has(material)) {
      // Paint and carbon: a clear coat over the base layer.
      const physical = toPhysical(standard);
      physical.userData.clearcoat = 1;
      physical.clearcoatRoughness = kind === 'paint' ? PAINT_CLEARCOAT_ROUGHNESS : CARBON_CLEARCOAT_ROUGHNESS;
      if (kind === 'paint') physical.roughness = THREE.MathUtils.clamp(physical.roughness, 0.2, 0.5);
      physical.clearcoat = currentQuality === 'low' ? 0 : 1;
      varnished.push(physical);
      if (physical !== material) replaced.set(material, physical);
    }
  }
  for (const material of authoredClearcoat) {
    const physical = material as THREE.MeshPhysicalMaterial;
    physical.clearcoatRoughness = Math.min(physical.clearcoatRoughness, 0.08);
    physical.userData.clearcoat = physical.clearcoat;
    varnished.push(physical);
  }
  if (replaced.size > 0) {
    for (const mesh of meshes) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => replaced.get(material) ?? material)
        : replaced.get(mesh.material) ?? mesh.material;
    }
    for (const material of replaced.keys()) material.dispose();
  }
  applyVarnishQuality(varnished, currentQuality);
  return varnished;
}

/** Low quality drops the clear coat (one less specular layer per pixel). */
export function applyVarnishQuality(materials: THREE.MeshPhysicalMaterial[], quality: GameSettings['quality']): void {
  currentQuality = quality;
  for (const material of materials) {
    material.clearcoat = quality === 'low' ? 0 : (material.userData.clearcoat as number | undefined) ?? 1;
  }
}

export function setVarnishQualityDefault(quality: GameSettings['quality']): void {
  currentQuality = quality;
}
